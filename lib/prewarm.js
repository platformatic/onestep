'use strict'

const { request } = require('undici')
const core = require('@actions/core')

const PREWARM_REQUEST_TIMEOUT = 2 * 60 * 1000
const PREWARM_REQUEST_ATTEMPTS = 5

async function makePrewarmRequest (appUrl, attempt = 1) {
  try {
    const { statusCode, body } = await request(appUrl, {
      method: 'GET',
      headersTimeout: PREWARM_REQUEST_TIMEOUT
    })

    if (statusCode !== 200) {
      const error = await body.text()
      throw new Error(`Could not make a prewarm call: ${statusCode} ${error}`)
    }
  } catch (error) {
    if (attempt < PREWARM_REQUEST_ATTEMPTS) {
      core.warning(`Could not make a prewarm call: ${error.message}, retrying...`)
      return makePrewarmRequest(appUrl, attempt + 1)
    }
    throw error
  }
}

module.exports = makePrewarmRequest
