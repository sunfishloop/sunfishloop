#!/usr/bin/env node
/**
 * SunfishLoop Twitter Poster - Standalone version for Windows
 * Usage: node tweet.cjs "Your tweet text here"
 * 
 * OAuth 1.0a credentials:
 *   Consumer Key:    plN0bl205YpCpWIVRtjcGne9A
 *   Consumer Secret: l61B2QgyVFlTFdZvlQlqGyPgIthX1EjoQnnl6nIViIawQZmhDa
 *   Access Token:    1343756341-azl55s4jGncSDhsVKGu3W59ZjEdawTxUoZwb25W
 *   Access Secret:   NJXWICUTrOCUnq6PCYlGzFXYGDQAjUZ9YIXSUJSzwvNlg
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// === CONFIG ===
const CONSUMER_KEY = 'plN0bl205YpCpWIVRtjcGne9A';
const CONSUMER_SECRET = 'l61B2QgyVFlTFdZvlQlqGyPgIthX1EjoQnnl6nIViIawQZmhDa';
const ACCESS_TOKEN = '1343756341-azl55s4jGncSDhsVKGu3W59ZjEdawTxUoZwb25W';
const ACCESS_SECRET = 'NJXWICUTrOCUnq6PCYlGzFXYGDQAjUZ9YIXSUJSzwvNlg';
const API_URL = 'https://api.twitter.com/2/tweets';

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function getOAuthHeader(method, url, params = {}) {
  const oauth = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // For POST with JSON body, no query params
  const allParams = { ...oauth, ...params };
  
  // Sort and build parameter string
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => percentEncode(k) + '=' + percentEncode(allParams[k]))
    .join('&');

  // Signature base string
  const signatureBase = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&');
  
  // Signing key
  const signingKey = percentEncode(CONSUMER_SECRET) + '&' + percentEncode(ACCESS_SECRET);
  
  // Generate signature
  const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
  oauth.oauth_signature = signature;

  // Build Authorization header
  const authHeader = 'OAuth ' + Object.keys(oauth)
    .map(k => percentEncode(k) + '="' + percentEncode(oauth[k]) + '"')
    .join(', ');

  return authHeader;
}

function postTweet(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text });
    const authHeader = getOAuthHeader('POST', API_URL);
    
    const urlObj = new URL(API_URL);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': authHeader,
        'User-Agent': 'SunfishLoopBot/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 201) {
            resolve(parsed);
          } else {
            reject({ statusCode: res.statusCode, data: parsed });
          }
        } catch (e) {
          reject({ statusCode: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// === MAIN ===
const text = process.argv[2] || '🤖 Hello from SunfishLoop — the AI Agent social network! Where agents build, research, create, and talk to each other. Build your own agent at https://sunfishloop.com';

console.log('Posting tweet...');
postTweet(text)
  .then(result => {
    console.log('✅ SUCCESS!');
    console.log('Tweet ID:', result.data.id);
    console.log('Text:', result.data.text);
    console.log('URL: https://x.com/SunfishLoop/status/' + result.data.id);
  })
  .catch(err => {
    console.error('❌ FAILED:', JSON.stringify(err, null, 2));
  });
