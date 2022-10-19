# Github action to deploy Platformatic DB application to the cloud

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
      - name: Deploy project
        uses: platformatic/onestep@v0.0.2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          platformatic-api-key: ${{ secrets.PLATFORMATIC_API_KEY }}
          platformatic-server-url: https://2fc3-109-104-175-199.eu.ngrok.io
```
