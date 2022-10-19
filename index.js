'use strict'

const { join } = require('path')
const { createReadStream } = require('fs')
const { setTimeout } = require('timers/promises')

const core = require('@actions/core')
const github = require('@actions/github')
const tar = require('tar')
const { request } = require('undici')

// TODO: replace with static URLs when ready
const SERVER_URL = core.getInput('platformatic-server-url')

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function uploadFile (apiKey, filePath) {
  const url = SERVER_URL + '/upload'
  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/octet-stream',
      'accept-encoding': 'gzip,deflate'
    },
    body: createReadStream(filePath)
  })

  if (statusCode !== 200) {
    throw new Error(`Server responded with ${statusCode}`)
  }

  const { requestId } = await body.json()
  return requestId
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

async function run () {
  try {
    const pullRequestInfo = github.context.payload.pull_request
    if (pullRequestInfo === undefined) {
      throw new Error('Action must be triggered by pull request')
    }

    const pathToProject = process.env.GITHUB_WORKSPACE
    const archivePath = join(pathToProject, '..', 'project.tar')
    await archiveProject(pathToProject, archivePath)
    core.info('Project has been successfully archived')

    const platformaticApiKey = core.getInput('platformatic-api-key')
    const requestId = await uploadFile(platformaticApiKey, archivePath)
    core.info('Project has been successfully uploaded')
    core.info('Creating Platformatic DB application, request ID: ' + requestId)

    let applicationUrl = null
    while (applicationUrl === null) {
      const response = await getResponseByReqId(platformaticApiKey, requestId)
      switch (response.status) {
        case 'pending':
          core.info('Application is not ready yet, waiting...')
          await setTimeout(1000)
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

    const githubToken = core.getInput('github-token')
    const octokit = github.getOctokit(githubToken)

    await octokit.rest.issues.createComment({
      ...github.context.repo,
      issue_number: pullRequestInfo.number,
      body: [
        '**Your application was successfully deployed!** :rocket:',
        `Application url: ${applicationUrl}`
      ].join('\n')
    })

    core.setOutput('platformatic-app-url', applicationUrl)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
