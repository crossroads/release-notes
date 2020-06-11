const showdown  = require('showdown');
const sgMail    = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function sendMarkdown(md, params) {
  let converter = new showdown.Converter();
  
  const msg = {
    to: params.to.split(','),
    from: params.from || 'deployer@goodcity.hk',
    subject: params.subject || 'Release Notes',
    html: converter.makeHtml(md)
  };

  return sgMail.send(msg);
}

module.exports = { sendMarkdown };