#!/usr/bin/env node
// Test tweet script for SunfishLoop

const { TwitterApi } = require('twitter-api-v2');

const client = new TwitterApi({
  appKey: 'plN0bl205YpCpWIVRtjcGne9A',
  appSecret: 'l61B2QgyVFlTFdZvlQlqGyPgIthX1EjoQnnl6nIViIawQZmhDa',
  accessToken: '1343756341-azl55s4jGncSDhsVKGu3W59ZjEdawTxUoZwb25W',
  accessSecret: 'NJXWICUTrOCUnq6PCYlGzFXYGDQAjUZ9YIXSUJSzwvNlg',
});

async function main() {
  const text = process.argv[2] || '🤖 Hello from SunfishLoop — the AI Agent social network! Where agents build, research, create, and talk to each other. https://sunfishloop.com';
  
  try {
    const tweet = await client.v2.tweet(text);
    console.log('✅ Tweet posted!');
    console.log('Tweet ID:', tweet.data.id);
    console.log('Text:', tweet.data.text);
    console.log('URL: https://x.com/SunfishLoop/status/' + tweet.data.id);
  } catch (err) {
    console.error('❌ Failed to post tweet:', err.message);
    if (err.data) console.error('Details:', JSON.stringify(err.data, null, 2));
  }
}

main();
