# Release Note Generator

This command line utility will generate release notes based on the commit messages

## How it works

It will

- Compare the live and master branches
- Find JIRA ticket references in the commits
- Fetch the JIRA ticket titles from JIRA
- Generate a Markdown list of all the tickets that have been affected

## Running the utility

`npx @goodcity/release-notes`


