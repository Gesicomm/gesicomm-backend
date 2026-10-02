'use strict';
const cron = require('node-cron');
const { runCycle } = require('../speedbox/service');
const { logger } = require('../../utils/logger');
let running = false;
function iniciarJobSpeedbox() {
  if (process.env.SPEEDBOX_ENABLED !== 'true') return;
  return cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try { await runCycle(); }
    catch (error) { logger.error({ evento: 'SPEEDBOX_CYCLE_FAILED', message: error.message }); }
    finally { running = false; }
  });
}
module.exports = { iniciarJobSpeedbox };
