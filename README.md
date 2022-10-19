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
        uses: platformatic/onestep@v0.0.3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_api_key: ${{ secrets.PLATFORMATIC_API_KEY }}
          platformatic_server_url: https://bab9-109-104-175-199.eu.ngrok.io
        env:
          plt_custom_variable: test1
          plt_custom_secret_variable: ${{ secrets.CUSTOM_SECRET_VARIABLE }}
```
