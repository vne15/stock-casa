const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

let qrData = null;
let isConnected = false;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Endpoint para conectar y obtener QR
  if (req.method === 'GET') {
    if (isConnected) {
      return res.status(200).json({
        status: 'connected',
        message: '✅ Bot ya está conectado a WhatsApp'
      });
    }

    // Si ya hay un QR guardado, devolverlo
    if (qrData) {
      const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;
      return res.status(200).json({
        status: 'qr_ready',
        qr: qrData,
        qrImage: qrImage,
        instructions: 'Escanea el código QR con WhatsApp para conectar'
      });
    }

    // Iniciar nueva conexión
    try {
      const authFolder = './auth_info_baileys';
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Stock Casa', 'Chrome', '1.0.0']
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
          qrData = qr;
          console.log('QR generado:', qr);
        }
        
        if (connection === 'open') {
          isConnected = true;
          qrData = null;
          console.log('✅ Conectado a WhatsApp!');
        }
        
        if (connection === 'close') {
          isConnected = false;
          qrData = null;
          console.log('❌ Desconectado');
        }
      });

      // Esperar 3 segundos para que genere el QR
      await new Promise(resolve => setTimeout(resolve, 3000));

      if (qrData) {
        const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;
        return res.status(200).json({
          status: 'qr_ready',
          qr: qrData,
          qrImage: qrImage,
          instructions: 'Escanea el código QR con WhatsApp'
        });
      }

      return res.status(200).json({
        status: 'connecting',
        message: '🔄 Generando QR...'
      });

    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: '❌ Error: ' + error.message
      });
    }
  }

  return res.status(404).json({ error: 'Not found' });
};