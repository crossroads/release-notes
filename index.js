#!/usr/bin/env node

process.env.DEBUG = '*,-follow-redirects';

const { program }   = require('commander');
const _             = require('lodash');
const JiraClient    = require('jira-client');
const { execSync }  = require('child_process');
const readline      = require('readline');
const { Writable }  = require('stream');
const info          = require('debug')('goodcity');
const notify        = require('debug')('input');
const error         = require('debug')('error');
const markdownpdf   = require("markdown-pdf") 
const clipboardy    = require('clipboardy');
const repo          = require('./lib/repo');
const mailer        = require('./lib/mailer');
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

program.parse(process.argv);

const REPO_NAME   = `${repo.getRepoName()} v${repo.getRepoVersion()}`
const OUTPUT_PDF  = `./release-${REPO_NAME.replace(/ /g, '-')}.pdf`

// -------------------------------
// -- Output Helpers
// -------------------------------

const toPDF = (markdown, filepath) => {
  return new Promise((good, bad) => {
    markdownpdf().from.string(markdown).to(filepath, (error) => {
      if (error) {
        bad(error);
      } else {
        good(filepath);
      }
    });
  });
};


// -------------------------------
// -- Input Helpers
// -------------------------------

const mutableStdout = new Writable({
  write(chunk, encoding, callback) {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: mutableStdout,
  terminal: true
});

const question = (text, defaultAnswer, opts = {}) => new Promise((done) => {
  mutableStdout.muted = _.get(opts, 'muted', false);
  notify(`[please answer] ${text}`);
  rl.question('', (answer) => {
    mutableStdout.muted = false;
    done(answer || defaultAnswer)
  });
});


// -------------------------------
// -- Markdown Generation
// -------------------------------

async function generateMarkdown() {
  info('Reading repo');

  const repoUrl = execSync('git config --get remote.origin.url');

  info('Running git fetch')

  execSync(`git fetch`);

  info('Reading unreleased commits');

  const logs = execSync(`
    git --no-pager log \
      --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr)%Creset' \
      --abbrev-commit \
      --date=relative \
      ${program.base}..${program.head}
  `);

  // Extract the Ticket numbers from the text

  const tickets = _.chain(logs)
    .split('\n')
    .filter(str => /GCW-\d+/.test(str))
    .map(str => /(GCW-\d+)/.exec(str)[1])
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
    host: 'jira.crossroads.org.hk',
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
  return `
# Release notes ${REPO_NAME}

**Generated on:** ${new Date().toLocaleString()}

**Repository:** \`${repoUrl}\`

## Tickets affected by this release

${ticketList}
`;
}

// -------------------------------
// -- Trigger the generation
// -------------------------------

(async function () {
  try {
    const markdown = await generateMarkdown();
    if (program.pdf) {
      info('generating pdf');
      const filepath = await toPDF(markdown, OUTPUT_PDF);
      info(`File ${filepath} generated`);
    } else {
      console.log('----------------------------------------------------------------------------');
      console.log(markdown);
      console.log('----------------------------------------------------------------------------');
    }

    if (program.clipboard) {
      clipboardy.writeSync(markdown);
      info(`Output copied to the clipboard`);
    }

    if (program.emailTo) {
      info(`Emailing the release notes`);
      await mailer.sendMarkdown(markdown, {
        to: program.emailTo,
        subject: `${program.emailSubject || 'Release notes'} - ${REPO_NAME}`
      })
    }

    process.exit(0);
  } catch (e) {
    console.log(e);
    error(e.toString());
    process.exit(1);
  }
})();