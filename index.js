'use strict'

const { join } = require('path')
const { createHash } = require('crypto')
const { existsSync } = require('fs')
const { readFile, writeFile } = require('fs/promises')

const core = require('@actions/core')
const github = require('@actions/github')
const tar = require('tar')
const { request } = require('undici')

// TODO: replace with static URLs when ready
const STEVE_SERVER_URL = core.getInput('steve_server_url') || 'https://plt-steve.fly.dev'
const HARRY_SERVER_URL = core.getInput('harry_server_url') || 'https://plt-harry.fly.dev'

const PLT_MESSAGE_REGEXP = /\*\*Your application was successfully deployed!\*\* :rocket:\nApplication url: (.*).*/

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function createBundle (apiKey, repository, pullRequestDetails, codeChecksum) {
  const url = STEVE_SERVER_URL + '/bundles'

  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      'x-platformatic-api-key': apiKey,
      'content-type': 'application/json',
      'accept-encoding': '*',
      accept: 'application/json'
    },

    body: JSON.stringify({
      codeChecksum,
      repository,
      pullRequestDetails: {
        branch: pullRequestDetails.head.ref,
        prTitle: pullRequestDetails.title,
        prNumber: pullRequestDetails.number,
        location: pullRequestDetails.head.repo.full_name,
        commitHash: pullRequestDetails.head.sha,
        commitUsername: pullRequestDetails.head.user.login,
        additions: pullRequestDetails.additions,
        deletions: pullRequestDetails.deletions
      }
    })
  })

  if (statusCode !== 200) {
    throw new Error(`Could not create a bundle: ${statusCode}`)
  }

  return body.json()
}

async function uploadCodeArchive (uploadToken, fileData) {
  const url = HARRY_SERVER_URL + '/upload'
  const { statusCode } = await request(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-tar',
      authorization: `Bearer ${uploadToken}`
    },
    body: fileData,
    headersTimeout: 60 * 1000
  })

  if (statusCode !== 200) {
    throw new Error(`Failed to upload code archive: ${statusCode}`)
  }
}

async function createDeployment (apiKey, bundleId) {
  const url = STEVE_SERVER_URL + `/bundles/${bundleId}/deployment`

  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      'x-platformatic-api-key': apiKey,
      'content-type': 'application/json',
      'accept-encoding': '*',
      accept: 'application/json'
    },

    body: JSON.stringify({ bundleId })
  })

  if (statusCode !== 200) {
    throw new Error(`Could not create a bundle: ${statusCode}`)
  }

  return body.json()
}

function generateMD5Hash (buffer) {
  return createHash('md5').update(buffer).digest('base64')
}

async function getPullRequestDetails (octokit) {
  const pullRequestInfo = github.context.payload.pull_request
  if (pullRequestInfo === undefined) {
    throw new Error('Action must be triggered by pull request')
  }

  const { data: pullRequestDetails } = await octokit.rest.pulls.get({
    owner: pullRequestInfo.base.repo.owner.login,
    repo: pullRequestInfo.base.repo.name,
    pull_number: pullRequestInfo.number
  })

  return pullRequestDetails
}

function getGithubEnvVariables () {
  const userEnvVars = {}
  for (const key in process.env) {
    const upperCaseKey = key.toUpperCase()
    if (upperCaseKey.startsWith('PLT_')) {
      userEnvVars[upperCaseKey] = process.env[key]
    }
  }
  return userEnvVars
}

function serializeEnvVariables (envVars) {
  let serializedEnvVars = ''
  for (const key in envVars) {
    serializedEnvVars += `${key}=${envVars[key]}\n`
  }
  return serializedEnvVars
}

function parseEnvVariables (envVars) {
  const parsedEnvVars = {}
  for (const line of envVars.split('\n')) {
    if (line === '') continue
    const [key, value] = line.split('=')
    parsedEnvVars[key] = value
  }
  return parsedEnvVars
}

async function mergeEnvVariables (envFilePath) {
  const githubEnvVars = getGithubEnvVariables()

  if (Object.keys(githubEnvVars).length === 0) return

  let userEnvVars = {}
  if (existsSync(envFilePath)) {
    const userEnvFile = await readFile(envFilePath, 'utf8')
    userEnvVars = parseEnvVariables(userEnvFile)
  }

  const mergedEnvVars = { ...githubEnvVars, ...userEnvVars }
  await writeFile(envFilePath, serializeEnvVariables(mergedEnvVars))
}

async function findLastPlatformaticComment (octokit) {
  const pullRequestInfo = github.context.payload.pull_request
  if (pullRequestInfo === undefined) {
    throw new Error('Action must be triggered by pull request')
  }

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: pullRequestInfo.base.repo.owner.login,
    repo: pullRequestInfo.base.repo.name,
    issue_number: pullRequestInfo.number
  })

  const platformaticComments = comments
    .filter(comment =>
      comment.user.login === 'github-actions[bot]' &&
        PLT_MESSAGE_REGEXP.test(comment.body)
    )
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))

  if (platformaticComments.length === 0) {
    return null
  }

  const lastComment = platformaticComments[platformaticComments.length - 1]
  return lastComment.id
}

function createPlatformaticComment (applicationUrl, commitHash, commitUrl) {
  return [
    '**Your application was successfully deployed!** :rocket:',
    `Application url: ${applicationUrl}`,
    `Built from the commit: [${commitHash.slice(0, 7)}](${commitUrl})`
  ].join('\n')
}

async function postPlatformaticComment (octokit, comment) {
  const pullRequestInfo = github.context.payload.pull_request
  if (pullRequestInfo === undefined) {
    throw new Error('Action must be triggered by pull request')
  }

  await octokit.rest.issues.createComment({
    ...github.context.repo,
    issue_number: pullRequestInfo.number,
    body: comment
  })
}

async function updatePlatformaticComment (octokit, commentId, comment) {
  const pullRequestInfo = github.context.payload.pull_request
  if (pullRequestInfo === undefined) {
    throw new Error('Action must be triggered by pull request')
  }

  await octokit.rest.issues.updateComment({
    ...github.context.repo,
    comment_id: commentId,
    body: comment
  })
}

async function run () {
  try {
    const platformaticApiKey = core.getInput('platformatic_api_key')
    if (!platformaticApiKey) {
      throw new Error('There is no Platformatic API key')
    }

    const githubToken = core.getInput('github_token')
    const octokit = github.getOctokit(githubToken)

    const repository = github.context.payload.repository.html_url
    const pullRequestDetails = await getPullRequestDetails(octokit)
    const pathToProject = process.env.GITHUB_WORKSPACE

    core.info('Merging environment variables')
    const envFileName = core.getInput('platformatic_env_file') || '.env'
    const envFilePath = join(pathToProject, envFileName)
    await mergeEnvVariables(envFilePath)

    const archivePath = join(pathToProject, '..', 'project.tar')
    await archiveProject(pathToProject, archivePath)
    core.info('Project has been successfully archived')

    const fileData = await readFile(archivePath)
    const codeChecksum = generateMD5Hash(fileData)

    const { bundleId, uploadToken } = await createBundle(
      platformaticApiKey,
      repository,
      pullRequestDetails,
      codeChecksum
    )

    core.info('Uploading code archive to the cloud...')
    await uploadCodeArchive(uploadToken, fileData)
    core.info('Project has been successfully uploaded')

    const { url } = await createDeployment(platformaticApiKey, bundleId)
    core.info('Application has been successfully created')
    core.info('Application URL: ' + url)

    // TODO: add prewarm request for application url

    const commitHash = pullRequestDetails.head.sha
    const commitUrl = pullRequestDetails.head.repo.html_url + '/commit/' + commitHash
    const platformaticComment = createPlatformaticComment(url, commitHash, commitUrl)

    const lastCommentId = await findLastPlatformaticComment(octokit)
    if (lastCommentId === null) {
      await postPlatformaticComment(octokit, platformaticComment)
    } else {
      await updatePlatformaticComment(octokit, lastCommentId, platformaticComment)
    }

    core.setOutput('platformatic_app_url', url)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
