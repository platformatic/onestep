'use strict'

const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { parseArgs } = require('node:util')
const parseArgsOptions = {
  version: {
    type: 'string'
  }
}

async function main () {
  const {
    values: { version }
  } = parseArgs({ options: parseArgsOptions })
  if (!version) {
    console.error('Please provide --version command argument')
    process.exit(1)
  }
  const packageJsonPath = join(__dirname, '..', 'package.json')
  const data = await readFile(packageJsonPath, 'utf-8')
  const json = JSON.parse(data)
  Object.keys(json.dependencies).forEach((dep) => {
    if (dep.startsWith('@platformatic')) {
      json.dependencies[dep] = `^${version}`
    }
  })
  await writeFile(packageJsonPath, JSON.stringify(json, null, 2))
}

main()
