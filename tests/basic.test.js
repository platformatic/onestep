'use strict'

const { tmpdir } = require('os')
const { join } = require('path')
const { mkdtemp, readdir, rm } = require('fs/promises')

const tar = require('tar')
const { test, before } = require('tap')

const { startDeployService, startMachine } = require('./helper.js')

let execaNode = null
before(async (t) => {
  const execa = await import('execa')
  execaNode = execa.execaNode
})

test('action should successfully deploy platformatic project', async (t) => {
  t.plan(10)

  const bundleId = 'test-bundle-id'
  const token = 'test-upload-token'

  const workspaceId = 'test-workspace-id'
  const workspaceKey = 'test-workspace-key'

  const entryPointUrl = await startMachine(t, () => {
    t.pass('Action should make a prewarm request to the machine')
  })

  await startDeployService(
    t,
    {
      createBundleCallback: (request, reply) => {
        t.equal(request.headers['x-platformatic-workspace-id'], workspaceId)
        t.equal(request.headers['x-platformatic-api-key'], workspaceKey)
        t.match(request.body, {
          bundle: {
            appType: 'db',
            configPath: 'platformatic.db.json'
          },
          repository: {
            name: 'test-repo-name',
            url: 'https://github.com/test-github-user/test-repo-name',
            githubRepoId: 1234
          },
          branch: {
            name: 'test'
          },
          commit: {
            sha: '1234',
            username: 'test-github-user',
            additions: 1,
            deletions: 1
          },
          pullRequest: {
            number: 1,
            title: 'Test PR title'
          }
        })
        t.ok(request.body.bundle.checksum)
        reply.code(200).send({ id: bundleId, token })
      },
      createDeploymentCallback: (request, reply) => {
        t.equal(request.headers['x-platformatic-workspace-id'], workspaceId)
        t.equal(request.headers['x-platformatic-api-key'], workspaceKey)
        t.equal(request.headers.authorization, `Bearer ${token}`)
        t.same(
          request.body,
          {
            label: 'github-pr:1',
            variables: {
              ENV_VARIABLE_1: 'value1',
              ENV_VARIABLE_2: 'value2',
              PLT_ENV_VARIABLE: 'value4',
              PLT_ENV_VARIABLE1: 'platformatic_variable1',
              PLT_ENV_VARIABLE2: 'platformatic_variable2'
            },
            secrets: {
              ENV_VARIABLE_3: 'value3'
            }
          }
        )
        reply.code(200).send({ entryPointUrl })
      },
      uploadCallback: (request) => {
        t.equal(request.headers.authorization, `Bearer ${token}`)
      }
    }
  )

  await execaNode('execute.js', {
    cwd: __dirname,
    env: {
      INPUT_PLATFORMATIC_WORKSPACE_ID: workspaceId,
      INPUT_PLATFORMATIC_WORKSPACE_KEY: workspaceKey,
      INPUT_GITHUB_TOKEN: 'test',
      INPUT_VARIABLES: 'ENV_VARIABLE_1,ENV_VARIABLE_2',
      INPUT_SECRETS: 'ENV_VARIABLE_3',

      ENV_VARIABLE_1: 'value1',
      ENV_VARIABLE_2: 'value2',
      ENV_VARIABLE_3: 'value3',
      PLT_ENV_VARIABLE: 'value4',
      IGNORED_ENV_VARIABLE: 'ignore'
    }
  })
})

test('action should show a warning if platformatic dep is not in the dev section', async (t) => {
  t.plan(11)

  const bundleId = 'test-bundle-id'
  const token = 'test-upload-token'

  const workspaceId = 'test-workspace-id'
  const workspaceKey = 'test-workspace-key'

  const entryPointUrl = await startMachine(t, () => {
    t.pass('Action should make a prewarm request to the machine')
  })

  await startDeployService(
    t,
    {
      createBundleCallback: (request, reply) => {
        t.equal(request.headers['x-platformatic-workspace-id'], workspaceId)
        t.equal(request.headers['x-platformatic-api-key'], workspaceKey)
        t.match(request.body, {
          bundle: {
            appType: 'db',
            configPath: 'platformatic.db.json'
          },
          repository: {
            name: 'test-repo-name',
            url: 'https://github.com/test-github-user/test-repo-name',
            githubRepoId: 1234
          },
          branch: {
            name: 'test'
          },
          commit: {
            sha: '1234',
            username: 'test-github-user',
            additions: 1,
            deletions: 1
          },
          pullRequest: {
            number: 1,
            title: 'Test PR title'
          }
        })
        t.ok(request.body.bundle.checksum)
        reply.code(200).send({ id: bundleId, token })
      },
      createDeploymentCallback: (request, reply) => {
        t.equal(request.headers['x-platformatic-workspace-id'], workspaceId)
        t.equal(request.headers['x-platformatic-api-key'], workspaceKey)
        t.equal(request.headers.authorization, `Bearer ${token}`)
        t.same(
          request.body,
          {
            label: 'github-pr:1',
            variables: {},
            secrets: {}
          }
        )
        reply.code(200).send({ entryPointUrl })
      },
      uploadCallback: (request) => {
        t.equal(request.headers.authorization, `Bearer ${token}`)
      }
    }
  )

  const child = await execaNode('execute.js', ['dev-dependency'], {
    cwd: __dirname,
    env: {
      INPUT_PLATFORMATIC_WORKSPACE_ID: workspaceId,
      INPUT_PLATFORMATIC_WORKSPACE_KEY: workspaceKey,
      INPUT_GITHUB_TOKEN: 'test'
    }
  })

  const outputLines = child.stdout.split('\n')
  const warningMessage = '::warning::Move platformatic dependency to devDependencies to speed up deployment'

  t.ok(outputLines.includes(warningMessage))
})

// TODO: remove this test
test('action should create a .env file if it does not exist', async (t) => {
  const bundleId = 'test-bundle-id'
  const token = 'test-upload-token'

  const entryPointUrl = await startMachine(t)

  await startDeployService(t, {
    createBundleCallback: (request, reply) => {
      reply.code(200).send({ id: bundleId, token })
    },
    createDeploymentCallback: (request, reply) => {
      reply.code(200).send({ entryPointUrl })
    },
    uploadCallback: async (request, reply) => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'action_env_'))
      const stream = request.raw.pipe(tar.x({ strip: 1, C: tmpDir }))

      t.teardown(async () => {
        await rm(tmpDir, { recursive: true })
      })

      stream.on('finish', async () => {
        const files = await readdir(tmpDir)
        t.ok(files.includes('.env'))
      })
    }
  })

  await execaNode('execute.js', ['dev-dependency'], {
    cwd: __dirname,
    env: {
      INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
      INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
      INPUT_GITHUB_TOKEN: 'test',
      PLT_ENV_VARIABLE1: 'value1'
    }
  })
})

test('action should fail if there is no platformatic_workspace_id input param', async (t) => {
  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::platformatic_workspace_id action param is required')
  }
})

test('action should fail if there is no platformatic_workspace_key input param', async (t) => {
  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::platformatic_workspace_key action param is required')
  }
})

test('action should fail if platformatic_api_key is wrong', async (t) => {
  await startDeployService(
    t,
    {
      createBundleCallback: (request, reply) => {
        reply.status(401).send({ message: 'Unauthorized' })
      }
    }
  )

  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
        PLT_ENV_VARIABLE3: 'value3'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Invalid platformatic_workspace_key provided')
  }
})

test('action should fail if it could not create a bundle', async (t) => {
  await startDeployService(
    t,
    {
      createBundleCallback: (request, reply) => {
        reply.status(500).send({ message: 'Error' })
      }
    }
  )

  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
        PLT_ENV_VARIABLE3: 'value3'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Could not create a bundle: 500')
  }
})

test('action should fail if platformatic_api_key is wrong', async (t) => {
  await startDeployService(
    t,
    {
      createDeploymentCallback: (request, reply) => {
        reply.status(401).send({ message: 'Unauthorized' })
      },
      uploadCallback: () => {
        t.pass('action should upload code to harry')
      }
    }
  )

  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
        PLT_ENV_VARIABLE3: 'value3'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Invalid platformatic_api_key provided')
  }
})

test('action should fail if it could not create a deployment', async (t) => {
  await startDeployService(
    t,
    {
      createDeploymentCallback: (request, reply) => {
        reply.status(500).send({ message: 'Error' })
      }
    }
  )

  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
        PLT_ENV_VARIABLE3: 'value3'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Could not create a deployment: 500')
  }
})

test('action should fail if it could not upload code tarball', async (t) => {
  await startDeployService(t, {
    uploadCallback: (request, reply) => {
      reply.status(500).send({ message: 'Error' })
    }
  })

  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
        PLT_ENV_VARIABLE3: 'value3'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Failed to upload code archive: 500')
  }
})

test('action should fail if it could not make a prewarm call', async (t) => {
  const bundleId = 'test-bundle-id'
  const token = 'test-upload-token'

  const entryPointUrl = await startMachine(t, (request, reply) => {
    reply.status(500).send({ message: 'Error' })
  })

  await startDeployService(t, {
    createBundleCallback: (request, reply) => {
      reply.code(200).send({ id: bundleId, token })
    },
    createDeploymentCallback: (request, reply) => {
      reply.code(200).send({ entryPointUrl })
    }
  })

  try {
    await execaNode('execute.js', {
      cwd: __dirname,
      env: {
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
        PLT_ENV_VARIABLE3: 'value3'
      }
    })
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
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
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
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test'
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
        INPUT_PLATFORMATIC_WORKSPACE_ID: 'test-workspace-id',
        INPUT_PLATFORMATIC_WORKSPACE_KEY: 'test-workspace-key',
        INPUT_GITHUB_TOKEN: 'test',
        INPUT_PLATFORMATIC_CONFIG_PATH: './platformatic.wrong.json'
      }
    })
  } catch (err) {
    t.equal(err.exitCode, 1)

    const lastLine = err.stdout.split('\n').pop()
    t.equal(lastLine, '::error::Invalid application type: wrong, must be one of: service, db')
  }
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
