'use strict'

const { tmpdir } = require('os')
const { join, basename } = require('path')
const { createHash } = require('crypto')
const { existsSync } = require('fs')
const { readFile, access, readdir, mkdtemp, rm } = require('fs/promises')

const tar = require('tar')
const { request } = require('undici')

const makePrewarmRequest = require('./lib/prewarm.js')

const APPLICATION_TYPES = ['service', 'db']
const CONFIG_FILE_EXTENSIONS = ['yml', 'yaml', 'json', 'json5', 'tml', 'toml']

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

class DeployClient {
  constructor (deployServiceHost, workspaceId, workspaceKey) {
    this.deployServiceHost = deployServiceHost
    this.workspaceId = workspaceId
    this.workspaceKey = workspaceKey

    this._bundleSize = null
    this._bundleChecksum = null
    this._sessionToken = null
  }

  async createBundle (
    appType,
    configPath,
    checksum,
    size,
    githubMetadata
  ) {
    const url = this.deployServiceHost + '/bundles'

    const { statusCode, body } = await request(url, {
      method: 'POST',
      headers: {
        'x-platformatic-workspace-id': this.workspaceId,
        'x-platformatic-api-key': this.workspaceKey,
        'content-type': 'application/json',
        'accept-encoding': '*',
        accept: 'application/json'
      },
      body: JSON.stringify({
        ...githubMetadata,
        bundle: {
          appType,
          configPath,
          checksum,
          size
        }
      })
    })

    if (statusCode !== 200) {
      if (statusCode === 401) {
        throw new Error('Invalid platformatic_workspace_key provided')
      }
      throw new Error(`Could not create a bundle: ${statusCode}`)
    }

    const { token } = await body.json()

    this._sessionToken = token
    this._bundleSize = size
    this._bundleChecksum = checksum
  }

  async uploadBundle (fileData) {
    const url = this.deployServiceHost + '/upload'
    const { statusCode } = await request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-tar',
        'Content-Length': this._bundleSize,
        'Content-MD5': this._bundleChecksum,
        authorization: `Bearer ${this._sessionToken}`
      },
      body: fileData,
      headersTimeout: 60 * 1000
    })

    if (statusCode !== 200) {
      throw new Error(`Failed to upload code archive: ${statusCode}`)
    }
  }

  async createDeployment (label, variables, secrets) {
    const url = this.deployServiceHost + '/deployments'

    const { statusCode, body } = await request(url, {
      method: 'POST',
      headers: {
        'x-platformatic-workspace-id': this.workspaceId,
        'x-platformatic-api-key': this.workspaceKey,
        'content-type': 'application/json',
        'accept-encoding': '*',
        authorization: `Bearer ${this._sessionToken}`,
        accept: 'application/json'
      },

      body: JSON.stringify({ label, variables, secrets })
    })

    if (statusCode !== 200) {
      if (statusCode === 401) {
        throw new Error('Invalid platformatic_workspace_key provided')
      }
      throw new Error(`Could not create a deployment: ${statusCode}`)
    }

    return body.json()
  }
}

function generateMD5Hash (buffer) {
  return createHash('md5').update(buffer).digest('base64')
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

async function findConfigFile (projectDir) {
  const files = await readdir(projectDir)

  for (const file of files) {
    const filename = basename(file)
    const filenameParts = filename.split('.')

    if (filenameParts.length === 3) {
      const [name, ext1, ext2] = filenameParts
      if (
        name === 'platformatic' &&
        APPLICATION_TYPES.includes(ext1) &&
        CONFIG_FILE_EXTENSIONS.includes(ext2)
      ) {
        return filename
      }
    }
  }

  return null
}

async function getEnvFileVariables (envFilePath) {
  if (!existsSync(envFilePath)) return {}

  const dotEnvFile = await readFile(envFilePath, 'utf8')
  return parseEnvVariables(dotEnvFile)
}

function getApplicationType (configPath) {
  const appType = configPath.split('.').slice(-2)[0]
  if (!APPLICATION_TYPES.includes(appType)) {
    throw new Error(`Invalid application type: ${appType}, must be one of: ${APPLICATION_TYPES.join(', ')}`)
  }
  return appType
}

async function isFileInProject (path) {
  try {
    await access(path)
    return true
  } catch (err) {
    return false
  }
}

async function checkPlatformaticDependency (logger, projectPath) {
  const packageJsonPath = join(projectPath, 'package.json')
  const packageJsonExist = await isFileInProject(packageJsonPath)
  if (!packageJsonExist) return

  const packageJsonData = await readFile(packageJsonPath, 'utf8')
  const packageJson = JSON.parse(packageJsonData)

  const dependencies = packageJson.dependencies
  if (
    dependencies !== undefined &&
    dependencies.platformatic !== undefined
  ) {
    logger.warn('Move platformatic dependency to devDependencies to speed up deployment')
  }
}

async function deploy ({
  deployServiceHost,
  workspaceId,
  workspaceKey,
  label,
  pathToProject,
  pathToConfig,
  pathToEnvFile,
  secrets,
  variables,
  githubMetadata,
  logger
}) {
  if (!workspaceId) {
    throw new Error('platformatic_workspace_id action param is required')
  }

  if (!workspaceKey) {
    throw new Error('platformatic_workspace_key action param is required')
  }

  await checkPlatformaticDependency(logger, pathToProject)

  if (pathToConfig) {
    const configFileExist = await isFileInProject(join(pathToProject, pathToConfig))
    if (!configFileExist) {
      throw new Error('There is no Platformatic config file')
    }
  } else {
    pathToConfig = await findConfigFile(pathToProject)
    if (pathToConfig === null) {
      throw new Error('Could not find Platformatic config file, please specify it in the action input')
    }
  }

  logger.info(`Found Platformatic config file: ${pathToConfig}`)

  const deployClient = new DeployClient(
    deployServiceHost,
    workspaceId,
    workspaceKey
  )

  const appType = getApplicationType(pathToConfig)

  const tmpDir = await mkdtemp(join(tmpdir(), 'plt-deploy-'))
  const bundlePath = join(tmpDir, 'project.tar')
  await archiveProject(pathToProject, bundlePath)
  logger.info('Project has been successfully archived')

  const bundle = await readFile(bundlePath)
  const bundleChecksum = generateMD5Hash(bundle)
  const bundleSize = bundle.length

  await deployClient.createBundle(
    appType,
    pathToConfig,
    bundleChecksum,
    bundleSize,
    githubMetadata
  )

  logger.info('Uploading bundle to the cloud...')
  await deployClient.uploadBundle(bundle)
  logger.info('Bundle has been successfully uploaded')

  await rm(tmpDir, { recursive: true })

  const envFilePath = join(pathToProject, pathToEnvFile || '.env')
  const envFileVars = await getEnvFileVariables(envFilePath)
  const mergedEnvVars = { ...envFileVars, ...variables }

  const { entryPointUrl } = await deployClient.createDeployment(
    label,
    mergedEnvVars,
    secrets
  )
  logger.info('Application has been successfully created')
  logger.info('Application URL: ' + entryPointUrl)

  logger.info('Making a prewarm application call...')
  await makePrewarmRequest(entryPointUrl, logger)
  logger.info('Application has been successfully prewarmed')

  return entryPointUrl
}

module.exports = { deploy }
