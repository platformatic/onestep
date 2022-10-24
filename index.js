'use strict'

const { join } = require('path')
const { createHash } = require('crypto')
const { readFile } = require('fs/promises')
const { setTimeout } = require('timers/promises')

const core = require('@actions/core')
const github = require('@actions/github')
const tar = require('tar')
const { request } = require('undici')

// TODO: replace with static URLs when ready
const SERVER_URL = core.getInput('platformatic_server_url')
const PULLING_TIMEOUT = 1000

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function createBucket (apiKey, pullRequestDetails, userEnvVars, md5Checksum) {
  const url = SERVER_URL + '/bucket'

  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userEnvVars, pullRequestDetails, md5Checksum })
  })

  if (statusCode !== 200) {
    throw new Error(`Server responded with ${statusCode}`)
  }

  return body.json()
}

async function uploadCodeArchive (uploadUrl, fileData, md5Checksum) {
  const { statusCode } = await request(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-tar',
      'Content-MD5': md5Checksum
    },
    body: fileData
  })

  if (statusCode !== 200) {
    throw new Error(`Failed to upload code archive: ${statusCode}`)
  }
}

function generateMD5Hash (buffer) {
  return createHash('md5').update(buffer).digest('base64')
}

async function getResponseByReqId (apiKey, requestId) {
  const url = SERVER_URL + '/url'
  const { statusCode, body } = await request(url, {
    method: 'GET',
    query: {
      request_id: requestId
    },
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  })

  if (statusCode !== 200) {
    throw new Error(`Server responded with ${statusCode}`)
  }

  return await body.json()
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
    number: pullRequestFullInfo.data.number,
    url: pullRequestFullInfo.data.html_url,
    title: pullRequestFullInfo.data.title,
    headSha: pullRequestFullInfo.data.head.sha,
    additions: pullRequestFullInfo.data.additions,
    deletions: pullRequestFullInfo.data.deletions,
    changedFiles: pullRequestFullInfo.data.changed_files
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
    const archivePath = join(pathToProject, '..', 'project.tar')
    await archiveProject(pathToProject, archivePath)
    core.info('Project has been successfully archived')

    const userEnvVars = getUserEnvVariables()

    const fileData = await readFile(archivePath)
    const md5Checksum = generateMD5Hash(fileData)

    const { requestId, uploadUrl } = await createBucket(
      platformaticApiKey,
      pullRequestDetails,
      userEnvVars,
      md5Checksum
    )
    await uploadCodeArchive(uploadUrl, fileData, md5Checksum)
    core.info('Project has been successfully uploaded')
    core.info('Creating Platformatic DB application, request ID: ' + requestId)

    let applicationUrl = null
    while (applicationUrl === null) {
      const response = await getResponseByReqId(platformaticApiKey, requestId)
      switch (response.status) {
        case 'pending':
          core.info('Application is not ready yet, waiting...')
          await setTimeout(PULLING_TIMEOUT)
          break
        case 'ready':
          applicationUrl = response.applicationUrl
          break
        case 'error':
          throw new Error('Application creation failed: ', response.error)
        default:
          throw new Error('Unknown response status: ', response.status)
      }
    }

    core.info('Application has been successfully created')
    core.info('Application URL: ' + applicationUrl)

    await octokit.rest.issues.createComment({
      ...github.context.repo,
      issue_number: pullRequestDetails.number,
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
