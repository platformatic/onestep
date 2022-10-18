'use strict'

const { join } = require('path')
const { createReadStream } = require('fs')

const core = require('@actions/core')
const tar = require('tar')
const { request } = require('undici')

// TODO: replace with static URLs when ready
const S3_SERVER_URL = core.getInput('platformatic-server-url')
const COMPENDIUM_URL = core.getInput('platformatic-server-url')
const GETAWAY_URL = core.getInput('platformatic-server-url')

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function uploadFile (apiKey, filePath) {
  const url = S3_SERVER_URL + '/upload'
  const { statusCode } = await request(url, {
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
}

async function createNewBucket (apiKey) {
  const url = COMPENDIUM_URL + '/bucket'
  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  })

  if (statusCode !== 200) {
    throw new Error(`Server responded with ${statusCode}`)
  }

  const { id } = await body.json()
  return id
}

async function getServerUrl (apiKey) {
  const url = GETAWAY_URL + '/url'
  const { statusCode, body } = await request(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  })

  if (statusCode !== 200) {
    throw new Error(`Server responded with ${statusCode}`)
  }

  const { url: applicationUrl } = await body.json()
  return applicationUrl
}

async function run () {
  try {
    const pathToProject = process.env.GITHUB_WORKSPACE
    const archivePath = join(pathToProject, '..', 'project.tar')
    await archiveProject(pathToProject, archivePath)
    core.info('Project has been successfully archived')

    const platformaticApiKey = core.getInput('platformatic-api-key')
    await uploadFile(platformaticApiKey, archivePath)
    core.info('Project has been successfully uploaded')

    const bucketId = await createNewBucket(platformaticApiKey)
    core.info(`New bucket has been created with id ${bucketId}`)

    const applicationUrl = await getServerUrl(platformaticApiKey)
    core.info(`Your application is available at ${applicationUrl}`)

    core.setOutput('platformatic-app-url', applicationUrl)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
