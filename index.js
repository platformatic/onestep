'use strict'

const { join } = require('path')
const { createReadStream } = require('fs')

const core = require('@actions/core')
const tar = require('tar')
const { request } = require('undici')

const S3_SERVER_URL = 'https://ec9a-109-104-175-199.eu.ngrok.io'
const COMPENDIUM_URL = 'https://ec9a-109-104-175-199.eu.ngrok.io'
const GETAWAY_URL = 'https://ec9a-109-104-175-199.eu.ngrok.io'

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

    const platformaticApiKey = core.getInput('platformatic-api-key')
    await uploadFile(platformaticApiKey, archivePath)
    const bucketId = await createNewBucket(platformaticApiKey)
    const applicationUrl = await getServerUrl(platformaticApiKey)

    console.log(bucketId, applicationUrl)
    core.setOutput('platformatic-app-url', applicationUrl)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
