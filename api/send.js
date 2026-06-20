const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        error: '❌ Se requiere "to" y "message"'
      });
    }

    try {
      const authFolder = './auth_info_baileys';
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      
      const sock = makeWASocket({
        auth: state,
        browser: ['Stock Casa', 'Chrome', '1.0.0']
      });

      sock.ev.on('creds.update', saveCreds);

      // Esperar conexión
      await new Promise((resolve) => {
        sock.ev.on('connection.update', (update) => {
          if (update.connection === 'open') {
            resolve();
          }
        });
      });

      // Enviar mensaje
      await sock.sendMessage(to, { text: message });
      
      return res.status(200).json({
        success: true,
        message: '✅ Mensaje enviado'
      });

    } catch (error) {
      return res.status(500).json({
        error: '❌ Error: ' + error.message
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};