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
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_api_key: ${{ secrets.PLATFORMATIC_API_KEY }}
          platformatic_server_url: https://2fc3-109-104-175-199.eu.ngrok.io
          custom_env_variable: 'Hello World!'
          custom_secret_env_variable: ${{ secrets.CUSTOM_SECRET_ENV_VARIABLE }}
```
