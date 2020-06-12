#!/usr/bin/env node

process.env.DEBUG = '*,-follow-redirects';

const { program }   = require('commander');
const _             = require('lodash');
const JiraClient    = require('jira-client');
const { execSync }  = require('child_process');
const info          = require('debug')('goodcity');
const error         = require('debug')('error');
const clipboardy    = require('clipboardy');
const repo          = require('./lib/repo');
const mailer        = require('./lib/mailer');
const { question }  = require('./lib/input');
const Markdown      = require('./lib/markdown');
const {
  version,
  name
} = require('./package.json');

program
  .name(name)
  .version(version)
  .option('-p, --pdf', 'ouputs to pdf')
  .option('-c, --clipboard', 'copies the markdown to your clipboard')
  .option('-h, --head <head>', 'The head ref or source branch', 'origin/master')
  .option('-b, --base <base>', 'The base ref or target branch', 'origin/live')
  .option('--email-to <email>', 'Recipients for the release notes')
  .option('--email-subject <subject>', 'Subject of the email')
  .option('--app-name <name>', 'Name of the app')
  .option('--jira-code <code>', 'Jira ticket code', 'GCW')

program.parse(process.argv);

const REPO_NAME   = program.appName || `${repo.getRepoName()} v${repo.getRepoVersion()}`
const OUTPUT_PDF  = `./release-${REPO_NAME.replace(/ /g, '-')}.pdf`

// -------------------------------
// -- Markdown Generation
// -------------------------------

async function generateMarkdown() {
  info('Reading repo');

  const repoUrl = execSync('git config --get remote.origin.url');

  info('Running git fetch')

  execSync(`git fetch --all`);

  info('Reading unreleased commits');

  const logs = execSync(`
    git --no-pager log \
      --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr)%Creset' \
      --abbrev-commit \
      --date=relative \
      ${program.base}..${program.head}
  `);

  // Extract the Ticket numbers from the text

  const ticketRegex = new RegExp(`(${program.jiraCode}-\\d+)`);

  const tickets = _.chain(logs)
    .split('\n')
    .filter(str => ticketRegex.test(str))
    .map(str => ticketRegex.exec(str)[1])
    .uniq()
    .value();

  if (!tickets.length) {
    info('No JIRA ticket information found');
    process.exit(0);
  } else {
    info(`${tickets.length} tickets found`);
  }

  // Log on to JIRA

  const jiraUsername = process.env.JIRA_USERNAME || await question('JIRA Username: ');
  const jiraPassword = process.env.JIRA_PASSWORD ||  await question('JIRA Password:', '', { muted: true })

  const jira = new JiraClient({
    protocol: 'https',
    host: process.env.JIRA_HOST || 'jira.crossroads.org.hk',
    username: jiraUsername,
    password: jiraPassword,
    apiVersion: '2',
    strictSSL: false
  });

  // Extract the titles of each ticket

  const summaries = {};

  for (const ticket of tickets) {
    info('Fetching ticket ' + ticket)
    try {
      const issue = await jira.findIssue(ticket);
      summaries[ticket] = _.trim(_.get(issue, 'fields.summary', ''));
    } catch (e) {
      if (e.statusCode !== 404) {
        throw e;
      } else {
        summaries[ticket] = '_Ticket information unavailable_'
      }
    }
  }

  // Output a markdown list

  info('generating markdown');

  const ticketList = _.map(tickets, ticket => `- [${ticket}](https://jira.crossroads.org.hk/browse/${ticket}) ${summaries[ticket]}`).join('\n');
  return new Markdown(`
# Release notes ${REPO_NAME}

**Generated on:** ${new Date().toLocaleString()}

**Repository:** \`${repoUrl}\`

## Tickets affected by this release

${ticketList}
`);
}

// -------------------------------
// -- Trigger the generation
// -------------------------------

(async function () {
  try {
    const markdown = await generateMarkdown();
    if (program.pdf) {
      info('generating pdf');
      await markdown.toPDF(OUTPUT_PDF);
      info(`File ${OUTPUT_PDF} generated`);
    } else {
      markdown.dump();
    }

    if (program.clipboard) {
      clipboardy.writeSync(markdown);
      info(`Output copied to the clipboard`);
    }

    if (program.emailTo) {
      info(`Emailing the release notes`);
      await mailer.sendMarkdown(markdown, {
        to: program.emailTo,
        subject: `[${REPO_NAME}] ${program.emailSubject || 'Release notes'}`
      })
    }

    process.exit(0);
  } catch (e) {
    console.log(e);
    error(e.toString());
    process.exit(1);
  }
})();