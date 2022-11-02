'use strict'

const { join } = require('path')
const { createHash } = require('crypto')
const { readFile, writeFile } = require('fs/promises')

const core = require('@actions/core')
const github = require('@actions/github')
const tar = require('tar')
const { request } = require('undici')

// TODO: replace with static URLs when ready
const STEVE_SERVER_URL = core.getInput('steve_server_url')
const HARRY_SERVER_URL = core.getInput('harry_server_url')

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function createBundle (apiKey, pullRequestDetails, codeChecksum) {
  const url = STEVE_SERVER_URL + '/api/bundles'

  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },

    body: JSON.stringify({ codeChecksum, pullRequestDetails })
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
    body: fileData
  })

  if (statusCode !== 200) {
    throw new Error(`Failed to upload code archive: ${statusCode}`)
  }
}

async function createDeployment (apiKey, bundleId) {
  const url = STEVE_SERVER_URL + '/api/deployments'

  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
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

  const pullRequestFullInfo = await octokit.rest.pulls.get({
    owner: pullRequestInfo.base.repo.owner.login,
    repo: pullRequestInfo.base.repo.name,
    pull_number: pullRequestInfo.number
  })

  return {
    url: pullRequestFullInfo.data.html_url,
    branch: pullRequestFullInfo.data.head.ref,
    prTitle: pullRequestFullInfo.data.title,
    prNumber: pullRequestFullInfo.data.number,
    location: pullRequestFullInfo.data.head.repo.full_name,
    commitHash: pullRequestFullInfo.data.head.sha,
    lastCommitUsername: pullRequestFullInfo.data.head.user.login,
    additions: pullRequestFullInfo.data.additions,
    deletions: pullRequestFullInfo.data.deletions
  }
}

function getUserEnvVariables () {
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

function createApplicationUrl (applicationDomain) {
  return `https://${applicationDomain}`
}

async function run () {
  try {
    const platformaticApiKey = core.getInput('platformatic_api_key')
    if (!platformaticApiKey) {
      throw new Error('There is no Platformatic API key')
    }

    const githubToken = core.getInput('github_token')
    const octokit = github.getOctokit(githubToken)

    const pullRequestDetails = await getPullRequestDetails(octokit)
    const pathToProject = process.env.GITHUB_WORKSPACE

    const userEnvVars = getUserEnvVariables()
    const githubEnvFilePath = join(pathToProject, '.github-env')
    await writeFile(githubEnvFilePath, serializeEnvVariables(userEnvVars))

    const archivePath = join(pathToProject, '..', 'project.tar')
    await archiveProject(pathToProject, archivePath)
    core.info('Project has been successfully archived')

    const fileData = await readFile(archivePath)
    const codeChecksum = generateMD5Hash(fileData)

    const { bundleId, uploadToken } = await createBundle(
      platformaticApiKey,
      pullRequestDetails,
      codeChecksum
    )

    core.info('Uploading code archive to the cloud...')
    await uploadCodeArchive(uploadToken, fileData)
    core.info('Project has been successfully uploaded')

    const { domainName } = await createDeployment(platformaticApiKey, bundleId)
    const applicationUrl = createApplicationUrl(domainName)
    core.info('Application has been successfully created')
    core.info('Application URL: ' + domainName)

    // TODO: add prewarm request for application url

    await octokit.rest.issues.createComment({
      ...github.context.repo,
      issue_number: pullRequestDetails.prNumber,
      body: [
        '**Your application was successfully deployed!** :rocket:',
        `Application url: ${applicationUrl}`
      ].join('\n')
    })

    core.setOutput('platformatic_app_url', applicationUrl)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
