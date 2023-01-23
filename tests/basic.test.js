'use strict'

const { tmpdir } = require('os')
const { join } = require('path')
const { mkdtemp, readdir, rm } = require('fs/promises')

const tar = require('tar')
const { test, before } = require('tap')

const {
  startControlPanel,
  startHarry,
  startMachine
} = require('./helper.js')

let execaNode = null
before(async (t) => {
  const execa = await import('execa')
  execaNode = execa.execaNode
})

test('action should fail if action is called not from pull request env', async (t) => {
  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        GITHUB_EVENT_PATH: 'skip'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Action must be triggered by pull request')
  }
})

test('action should successfully deploy platformatic project', async (t) => {
  t.plan(7)

  const bundleId = 'test-bundle-id'
  const uploadToken = 'test-upload-token'

  await startControlPanel(
    t,
    {
      createBundleCallback: (request, reply) => {
        t.equal(request.headers['x-platformatic-api-key'], '1234')
        t.match(request.body, {
          appType: 'db',
          configPath: 'platformatic.db.json',
          repository: {
            url: 'https://github.com/test-github-user/test-repo-name',
            name: 'test-repo-name'
          },
          pullRequestDetails: {
            branch: 'test',
            prTitle: 'Test PR title',
            prNumber: 1,
            location: 'test-github-user/test-repo-name',
            commitHash: '1234',
            commitUsername: 'test-github-user',
            additions: 1,
            deletions: 1
          }
        })
        t.ok(request.body.codeChecksum)

        reply.status(200).send({ bundleId, uploadToken })
      },
      createDeploymentCallback: (request) => {
        t.equal(request.headers['x-platformatic-api-key'], '1234')
        t.same(request.body, { bundleId })
      }
    }
  )

  await startHarry(t, (request) => {
    t.equal(request.headers.authorization, `Bearer ${uploadToken}`)
  })

  await startMachine(t, () => {
    t.pass('Action should make a prewarm request to the machine')
  })

  await execaNode('execute.js', {
    cwd: __dirname,
    env: {
      PLT_ENV_VARIABLE3: 'value3'
    }
  })
})

test('action should show a warning if platformatic dep is not in the dev section', async (t) => {
  t.plan(5)

  await startControlPanel(
    t,
    {
      createBundleCallback: () => {
        t.pass('Action should create a bundle')
      },
      createDeploymentCallback: () => {
        t.pass('Action should create a deployment')
      }
    }
  )

  await startHarry(t, () => {
    t.pass('Action should upload code to harry')
  })

  await startMachine(t, () => {
    t.pass('Action should make a prewarm request to the machine')
  })

  const child = await execaNode('execute.js', ['dev-dependency'], { cwd: __dirname })
  const outputLines = child.stdout.split('\n')

  const warningMessage = '::warning::Move platformatic dependency to devDependencies to speed up deployment'

  t.ok(outputLines.includes(warningMessage))
})

test('action should create a .env file if it does not exist', async (t) => {
  await startControlPanel(
    t,
    {
      createBundleCallback: () => {
        t.pass('Action should create a bundle')
      },
      createDeploymentCallback: () => {
        t.pass('Action should create a deployment')
      }
    }
  )

  await startHarry(t, async (request, reply) => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'action_env_'))
    const stream = request.raw.pipe(tar.x({ strip: 1, C: tmpDir }))

    t.teardown(async () => {
      await rm(tmpDir, { recursive: true })
    })

    stream.on('finish', async () => {
      const files = await readdir(tmpDir)
      t.ok(files.includes('.env'))
    })
  })

  await startMachine(t, () => {
    t.pass('Action should make a prewarm request to the machine')
  })

  await execaNode('execute.js', ['dev-dependency'], {
    cwd: __dirname,
    env: {
      PLT_ENV_VARIABLE3: 'value3'
    }
  })
})

test('action should fail if there is no platformatic_api_key input param', async (t) => {
  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_API_KEY: ''
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::There is no Platformatic API key')
  }
})

test('action should fail if platformatic_api_key is wrong', async (t) => {
  await startControlPanel(
    t,
    {
      createBundleCallback: (request, reply) => {
        reply.status(401).send({ message: 'Unauthorized' })
      }
    }
  )

  try {
    await execaNode('execute.js', { cwd: __dirname })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Invalid platformatic_api_key provided')
  }
})

test('action should fail if it could not create a bundle', async (t) => {
  await startControlPanel(
    t,
    {
      createBundleCallback: (request, reply) => {
        reply.status(500).send({ message: 'Error' })
      }
    }
  )

  try {
    await execaNode('execute.js', { cwd: __dirname })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Could not create a bundle: 500')
  }
})

test('action should fail if platformatic_api_key is wrong', async (t) => {
  await startControlPanel(
    t,
    {
      createDeploymentCallback: (request, reply) => {
        reply.status(401).send({ message: 'Unauthorized' })
      }
    }
  )

  await startHarry(t, () => {
    t.pass('action should upload code to harry')
  })

  try {
    await execaNode('execute.js', { cwd: __dirname })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Invalid platformatic_api_key provided')
  }
})

test('action should fail if it could not create a deployment', async (t) => {
  await startControlPanel(
    t,
    {
      createDeploymentCallback: (request, reply) => {
        reply.status(500).send({ message: 'Error' })
      }
    }
  )

  await startHarry(t, () => {
    t.pass('action should upload code to harry')
  })

  try {
    await execaNode('execute.js', { cwd: __dirname })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Could not create a deployment: 500')
  }
})

test('action should fail if it could not upload code tarball', async (t) => {
  await startControlPanel(
    t,
    {
      createDeploymentCallback: (request, reply) => {
        reply.status(500).send({ message: 'Error' })
      }
    }
  )

  await startHarry(t, (request, reply) => {
    reply.status(500).send({ message: 'Error' })
  })

  try {
    await execaNode('execute.js', { cwd: __dirname })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Failed to upload code archive: 500')
  }
})

test('action should fail if it could not make a prewarm call', async (t) => {
  await startControlPanel(t)
  await startHarry(t)

  await startMachine(t, (request, reply) => {
    reply.status(500).send({ message: 'Error' })
  })

  try {
    await execaNode('execute.js', { cwd: __dirname })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Could not make a prewarm call: 500 {"message":"Error"}')
  }
})

test('action should fail if there is no config file', async (t) => {
  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_CONFIG_PATH: './platformatic1.db.json'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::There is no Platformatic config file')
  }
})

test('action should fail it could not find a config file', async (t) => {
  try {
    await execaNode('execute.js', ['wrong-config-ext'], {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_CONFIG_PATH: ''
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Could not find Platformatic config file, please specify it in the action input')
  }
})

test('action should fail if config file has wrong ext', async (t) => {
  try {
    await execaNode('execute.js', ['wrong-config-ext'], {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_CONFIG_PATH: './platformatic.wrong.json'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Invalid application type: wrong, must be one of: service, db')
  }
})
