const { generateAuthUrl } = require('./fyersService');

// Test the authorization URL generation
const appId = 'XJFL311ATX-100';
const redirectUri = 'https://trade.fyers.in/api-login/redirect-uri/index.html';

const authUrl = generateAuthUrl(appId, '', redirectUri);

console.log('🔗 Generated Authorization URL:');
console.log(authUrl);
console.log('\n📋 Expected format from documentation:');
console.log('https://api-t1.fyers.in/api/v3/generate-authcode?client_id=SPXXXXE7-100&redirect_uri=https%3A%2F%2Fdev.fyers.in%2Fredirection%2Findex.html&response_type=code&state=sample_state&nonce=sample_nonce'); 