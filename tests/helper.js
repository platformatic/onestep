'use strict'

const { join } = require('path')
const { writeFile } = require('fs/promises')

const fastify = require('fastify')
const nock = require('nock')

async function createRepository (actionFolder, repositoryOptions = {}) {
  const owner = repositoryOptions.owner || 'test-github-user'
  const repositoryName = repositoryOptions.name || 'test-repo-name'

  const prNumber = repositoryOptions.pullRequest?.number || 1
  const prTitle = repositoryOptions.pullRequest?.title || 'Test PR title'

  const payload = {
    pull_request: {
      number: prNumber,
      base: {
        repo: {
          owner: {
            login: owner
          },
          name: repositoryName
        }
      }
    },
    repository: {
      name: repositoryName,
      html_url: `https://github.com/${owner}/${repositoryName}`,
      owner: {
        login: owner
      }
    }
  }

  const githubEventConfigPath = join(actionFolder, 'github_event.json')
  await writeFile(githubEventConfigPath, JSON.stringify(payload))
  process.env.GITHUB_EVENT_PATH = githubEventConfigPath

  startGithubApi(owner, repositoryName, prNumber, prTitle)
}

function startGithubApi (owner, repositoryName, prNumber, prTitle) {
  nock('https://api.github.com')
    .post(`/repos/${owner}/${repositoryName}/issues/${prNumber}/comments`)
    .reply(200, {})

  nock('https://api.github.com')
    .get(`/repos/${owner}/${repositoryName}/issues/${prNumber}/comments`)
    .reply(200, [])

  nock('https://api.github.com')
    .get(`/repos/${owner}/${repositoryName}/pulls/${prNumber}`)
    .reply(200, {
      head: {
        sha: '1234',
        ref: 'test',
        user: {
          login: owner
        }
      },
      base: {
        repo: {
          id: 1234,
          name: repositoryName,
          html_url: `https://github.com/${owner}/${repositoryName}`
        }
      },
      title: prTitle,
      number: prNumber,
      additions: 1,
      deletions: 1
    })
}

async function startControlPanel (t, options = {}) {
  const controlPanel = fastify({ keepAliveTimeout: 1 })

  controlPanel.post('/bundles', async (request, reply) => {
    const createBundleCallback = options.createBundleCallback || (() => {})
    await createBundleCallback(request, reply)

    return {
      bundleId: 'default-bundle-id',
      uploadToken: 'default-upload-token',
      entryPointId: 'default-entry-point-id',
      entryPointUrl: 'http://localhost:3044'
    }
  })

  controlPanel.post('/bundles/:bundleId/deployment', async (request, reply) => {
    const createDeploymentCallback = options.createDeploymentCallback || (() => {})
    await createDeploymentCallback(request, reply)
  })

  t.teardown(async () => {
    await controlPanel.close()
  })

  await controlPanel.listen({ port: 3042 })
  return controlPanel
}

async function startUploadServer (t, options = {}) {
  const uploadServer = fastify({ keepAliveTimeout: 1 })

  uploadServer.addContentTypeParser(
    'application/x-tar',
    { bodyLimit: 1024 * 1024 * 1024 },
    (request, payload, done) => done()
  )

  uploadServer.put('/upload', async (request, reply) => {
    const uploadCallback = options.uploadCallback || (() => {})
    await uploadCallback(request, reply)
  })

  t.teardown(async () => {
    await uploadServer.close()
  })

  await uploadServer.listen({ port: 3043 })
  return uploadServer
}

async function startMachine (t, callback = () => {}) {
  const machine = fastify({ keepAliveTimeout: 1 })

  machine.get('/', async (request, reply) => {
    await callback(request, reply)
  })

  t.teardown(async () => {
    await machine.close()
  })

  return machine.listen({ port: 0 })
}

module.exports = {
  createRepository,
  startControlPanel,
  startUploadServer,
  startMachine
}
