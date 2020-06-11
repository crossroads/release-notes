const sgMail    = require('@sendgrid/mail');

/**
 * Sends markdown as an email
 *
 * @param {Markdown} md
 * @param {object} params
 * @returns
 */
function sendMarkdown(md, params) {
  if (!process.env.SENDGRID_API_KEY) {
    throw 'Environment variable SENDGRID_API_KEY is missing';
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  let converter = new showdown.Converter();
  
  const msg = {
    to: params.to.split(','),
    from: params.from || 'deployer@goodcity.hk',
    subject: params.subject || 'Release Notes',
    html: md.toHTML()
  };

  return sgMail.send(msg);
}

module.exports = { sendMarkdown };