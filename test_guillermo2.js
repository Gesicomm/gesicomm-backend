require('dotenv').config({ path: '/Users/mertin/Proyectos/proyectos/Gesicomm/gesicomm-backend/.env' });
const EncryptionService = require('./src/utils/EncryptionService');
const axios = require('axios');

const encryptedToken = "f688c8939a128c43a06d6e12f18920f1:2a25569f1cfb23b1e7ee7090f0a21793:5bea81a894d5008cc96383c2faf1f65a6235afa9034f3da3ac499afc93ee4f4fb6bf6af8820ed067f820b928f59432598eace36af1567203db5472e55718926e75113409616d69e26020237c8a1cefa1f8662505b30e6cb9433a83055d6f2f282234d3340db92656b9a797b15a6291a929111b9ad3caf17989398bff8d78d101027e6ba1a22390122f379eebf793776ffda0eaceaae65cca8d6226107f5c47455c2a4e3a503aef039eed0cde1982b88901f24b4706b00609aa10e58fa3b412f70ab346aa480e1f16f6c45cfeecb930946fe6";
const token = EncryptionService.decrypt(encryptedToken);

async function check() {
  try {
    const ownedUrl = `https://graph.facebook.com/v23.0/1230886842132084/client_ad_accounts?access_token=${token}&fields=id,name`;
    const res2 = await axios.get(ownedUrl);
    console.log("Client Ad Accounts for BM - Somnix:", res2.data);
    
    const ownedUrl2 = `https://graph.facebook.com/v23.0/1230886842132084/owned_ad_accounts?access_token=${token}&fields=id,name`;
    const res3 = await axios.get(ownedUrl2);
    console.log("Owned Ad Accounts for BM - Somnix:", res3.data);
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}
check();
