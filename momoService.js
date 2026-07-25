const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'https://sandbox.momodeveloper.mtn.com/collection';
const PROVISION_BASE_URL = 'https://sandbox.momodeveloper.mtn.com';
const SUB_KEY = process.env.MTN_SUBSCRIPTION_KEY;
const ENV = process.env.MTN_ENVIRONMENT || 'sandbox';
const W_TARGET = process.env.WITHDRAWAL_TARGET || '256778212576';

// Load from env, but they might be empty
let API_USER_ID = process.env.MTN_API_USER_ID;
let API_KEY = process.env.MTN_API_KEY;

let cachedToken = null, tokenExpiry = 0;

function formatMsisdn(p) { 
  if(!p) return null; 
  p = String(p).replace(/\D/g, ''); 
  if (p.startsWith('256')) return p; 
  if (p.startsWith('0')) return '256'+p.slice(1); 
  return p; 
}

/**
 * Automates the MTN Sandbox onboarding process.
 * 1. Generates a UUID for API User ID
 * 2. Provisions the API User
 * 3. Requests the API Key
 */
async function provisionCredentials() {
  if (!SUB_KEY) throw new Error("MTN_SUBSCRIPTION_KEY is required in .env to auto-provision");
  
  const newUserId = uuidv4();
  console.log(`\n[1/4] 🔄 Momo Auto-Provision: Generated API User ID (X-Reference-Id): ${newUserId}`);

  // 1. Create the API User (Provisioning)
  const provisionUrl = `${PROVISION_BASE_URL}/v1_0/apiuser`;
  await axios.post(provisionUrl, {
    providerCallbackHost: "localhost"
  }, {
    headers: {
      "X-Reference-Id": newUserId,
      "Ocp-Apim-Subscription-Key": SUB_KEY,
      "Content-Type": "application/json"
    }
  });
  console.log("[2/4] ✅ Momo Auto-Provision: Successfully registered API User on MTN Sandbox.");

  // 2. Generate the API Key
  const keyUrl = `${PROVISION_BASE_URL}/v1_0/apiuser/${newUserId}/apikey`;
  const keyRes = await axios.post(keyUrl, {}, {
    headers: {
      "Ocp-Apim-Subscription-Key": SUB_KEY
    }
  });

  API_USER_ID = newUserId;
  API_KEY = keyRes.data.apiKey;

  console.log(`[3/4] ✅ Momo Auto-Provision: Successfully generated API Key: ${API_KEY}`);
  console.warn("⚠️ Save these in your .env file as MTN_API_USER_ID and MTN_API_KEY to stop auto-provisioning on restarts.\n");
}

/**
 * Fetches Bearer Token. If API_USER_ID and API_KEY are missing, it provisions them first.
 */
async function getToken() {
  const n = Date.now();
  if (cachedToken && n < tokenExpiry - 60000) return cachedToken;
  
  // Auto-provision if credentials are missing
  if (!API_USER_ID || !API_KEY) {
    await provisionCredentials();
  }

  const auth = Buffer.from(`${API_USER_ID}:${API_KEY}`).toString('base64');
  const r = await axios.post(`${BASE_URL}/token/`, null, { 
    headers: { 
      Authorization: `Basic ${auth}`, 
      'Ocp-Apim-Subscription-Key': SUB_KEY 
    } 
  });
  
  cachedToken = r.data.access_token;
  tokenExpiry = n + r.data.expires_in * 1000;
  console.log("[4/4] 🎉 Momo Auth: Bearer Token generated successfully!");
  return cachedToken;
}

async function deposit(phone, amount, ref) {
  const t = await getToken();
  return (await axios.post(`${BASE_URL}/v2_0/payment`, {
    amount: String(amount),
    currency: 'UGX',
    externalId: ref,
    payer: { partyIdType: 'MSISDN', partyId: formatMsisdn(phone) },
    payerMessage: 'SCHOOLAR HUB UG Wallet Funding',
    payeeNote: 'Deposit to Student Play Wallet'
  }, { headers: { Authorization: `Bearer ${t}`, 'X-Reference-Id': ref, 'X-Target-Environment': ENV, 'Ocp-Apim-Subscription-Key': SUB_KEY, 'Content-Type': 'application/json' } })).data;
}

async function status(ref) {
  const t = await getToken();
  return (await axios.get(`${BASE_URL}/v1_0/payment/${ref}`, { headers: { Authorization: `Bearer ${t}`, 'X-Target-Environment': ENV, 'Ocp-Apim-Subscription-Key': SUB_KEY } })).data;
}

async function withdraw(amount, ref) {
  const t = await getToken();
  return (await axios.post(`${BASE_URL}/v1_0/requesttowithdraw`, {
    amount: String(amount),
    currency: 'UGX',
    externalId: ref,
    payee: { partyIdType: 'MSISDN', partyId: W_TARGET },
    payerMessage: 'SCHOOLAR HUB UG Withdrawal',
    payeeNote: 'Withdrawal from Student Wallet'
  }, { headers: { Authorization: `Bearer ${t}`, 'X-Reference-Id': ref, 'X-Target-Environment': ENV, 'Ocp-Apim-Subscription-Key': SUB_KEY, 'Content-Type': 'application/json' } })).data;
}

module.exports = { formatMsisdn, getToken, deposit, status, withdraw, genRef: () => crypto.randomUUID() };