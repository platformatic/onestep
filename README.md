# deployer-action

Example of usage:

```yml
name: Deploy Platformatic DB application to the cloud

on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '**.md'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout application project repository
        uses: actions/checkout@v3
      - name: npm install --omit=dev
        run: npm install --omit=dev
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Cloning platformatic/deployer-action
        uses: actions/checkout@v3
        with:
          repository: platformatic/deployer-action
          ref: refs/heads/main
          token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          persist-credentials: false
          path: ./.github/deployer-action
      - name: Deploy project
        uses: ./.github/deployer-action
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          platformatic-api-key: ${{ secrets.PLATFORMATIC_API_KEY }}
          platformatic-server-url: https://2fc3-109-104-175-199.eu.ngrok.io
```
