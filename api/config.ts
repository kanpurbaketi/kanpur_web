import { getSetting, schema } from './_lib/db.js';
import { handle, method, send } from './_lib/http.js';

/*
 GET /api/config   what every player's game needs to know: whether ads show on the loading page (the admin's switch),
                   and the AdSense publisher and ad unit (ADSENSE_CLIENT, ADSENSE_SLOT in the environment).
*/

export default handle(async (req, res) => {
  method(req, 'GET');
  await schema();
  const on = await getSetting('ads_enabled', false);
  const client = process.env.ADSENSE_CLIENT ?? '', slot = process.env.ADSENSE_SLOT ?? '';
  send(res, 200, { ads: { enabled: on && !!client && !!slot, switchedOn: on, client, slot } });
});
