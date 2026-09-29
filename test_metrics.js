require('dotenv').config({ path: '.env' });
const EncryptionService = require('./src/utils/EncryptionService');
const axios = require('axios');

const encryptedToken = "f688c8939a128c43a06d6e12f18920f1:2a25569f1cfb23b1e7ee7090f0a21793:5bea81a894d5008cc96383c2faf1f65a6235afa9034f3da3ac499afc93ee4f4fb6bf6af8820ed067f820b928f59432598eace36af1567203db5472e55718926e75113409616d69e26020237c8a1cefa1f8662505b30e6cb9433a83055d6f2f282234d3340db92656b9a797b15a6291a929111b9ad3caf17989398bff8d78d101027e6ba1a22390122f379eebf793776ffda0eaceaae65cca8d6226107f5c47455c2a4e3a503aef039eed0cde1982b88901f24b4706b00609aa10e58fa3b412f70ab346aa480e1f16f6c45cfeecb930946fe6";
const token = EncryptionService.decrypt(encryptedToken);

async function check() {
  try {
    const url = `https://graph.facebook.com/v23.0/act_1457618889137322/campaigns?access_token=${token}&fields=id,name,insights.date_preset(maximum){spend,actions,action_values,cost_per_action_type}&limit=5`;
    const res = await axios.get(url);
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}
check();
