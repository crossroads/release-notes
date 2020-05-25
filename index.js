#!/usr/bin/env node

process.env.DEBUG = '*';

const _             = require('lodash');
const JiraClient    = require('jira-client');
const { execSync }  = require('child_process');
const readline      = require('readline');
const { Writable }  = require('stream');
const info          = require('debug')('goodcity');
const notify        = require('debug')('input');
const error         = require('debug')('error');

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
  const upToDate = await question("Are the local live and master branches up to date? Y/n: ", 'Y');

  if (upToDate !== 'y' && upToDate !== 'Y') {
    return process.exit(0);
  }

  info('Reading unreleased commits');

  const logs = execSync(`
    git --no-pager log \
      --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr)%Creset' \
      --abbrev-commit \
      --date=relative \
      live..master
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

  const jiraUsername = await question('JIRA Username: ');
  const jiraPassword = await question('JIRA Password:', '', { muted: true })

  const jira = new JiraClient({
    protocol: 'https',
    host: 'jira.crossroads.org.hk',
    username: jiraUsername,
    password: jiraPassword,
    apiVersion: '2',
    strictSSL: true
  });


  // Extract the titles of each ticket

  const summaries = {};

  for (const ticket of tickets) {
    info('Fetching ticket ' + ticket)
    const issue = await jira.findIssue(ticket);
    summaries[ticket] = _.get(issue, 'fields.summary', '');
  }

  // Output a markdown list

  info('generating markdown');

  const ticketList = _.map(tickets, ticket => `- [${ticket}](https://jira.crossroads.org.hk/browse/${ticket}) ${summaries[ticket]}`).join('\n');
  return `
# Tickets affected by this release

${ticketList}
`;
}

// -------------------------------
// -- Trigger the generation
// -------------------------------

(async function () {
  try {
    const markdown = await generateMarkdown();
    console.log('----------------------------------------------------------------------------');
    console.log(markdown);
    console.log('----------------------------------------------------------------------------');
    process.exit(0);
  } catch (e) {
    error(e.toString());
    process.exit(1);
  }
})();