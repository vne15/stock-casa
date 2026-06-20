const { createClient } = require('@supabase/supabase-js');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Configuración Supabase
const supabase = createClient(
  `https://${process.env.SUPABASE_URL || 'zzpfzqxiyszgkeqxmhrn.supabase.co'}`,
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_hr2KcUlqrhaWLIF8OM1-vA_lUJMCWCX'
);

let sock = null;
let isConnected = false;
let qrCode = null;
let lastMessage = null;

// Estado de la conexión (para mantener en memoria)
const state = {
  sock: null,
  isConnected: false,
  qrCode: null,
  status: 'disconnected'
};

// ============ FUNCIONES DE PROCESAMIENTO ============

function normalizeText(text) {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

function extractQuantity(text) {
  const numbers = {
    'un': 1, 'una': 1, 'uno': 1,
    'dos': 2, 'tres': 3, 'cuatro': 4,
    'cinco': 5, 'seis': 6, 'siete': 7,
    'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13,
    'catorce': 14, 'quince': 15
  };
  
  let quantity = 1;
  let cleanText = text;
  
  for (const [word, num] of Object.entries(numbers)) {
    if (text.includes(word)) {
      quantity = num;
      cleanText = text.replace(word, '').trim();
      break;
    }
  }
  
  const numberMatch = text.match(/\b(\d+)\b/);
  if (numberMatch) {
    quantity = parseInt(numberMatch[1]);
    cleanText = text.replace(numberMatch[1], '').trim();
  }
  
  return { quantity, cleanText };
}

function extractProduct(text) {
  const removeWords = [
    'gaste', 'gasté', 'consumí', 'usé', 'me comí', 'me tomé',
    'me acabé', 'terminé', 'utilicé', 'me bebí', 'compré',
    'compre', 'comprar', 'traje', 'añadí', 'agregué', 'nuevo',
    'compró', 'falta', 'faltan', 'necesito', 'requiero',
    'no hay', 'se acabó', 'terminó', 'acabó', 'un', 'una',
    'el', 'la', 'los', 'las', 'de', 'para', 'por', 'con',
    'sin', 'sobre', 'entre'
  ];
  
  let clean = text;
  for (const word of removeWords) {
    clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), '');
  }
  
  return clean.trim();
}

async function findSimilarProduct(search) {
  const { data: products } = await supabase
    .from('productos')
    .select('nombre');
  
  if (!products || products.length === 0) return null;
  
  const exact = products.find(p => 
    p.nombre.toLowerCase() === search.toLowerCase()
  );
  if (exact) return exact.nombre;
  
  const partial = products.find(p => 
    p.nombre.toLowerCase().includes(search.toLowerCase()) ||
    search.toLowerCase().includes(p.nombre.toLowerCase())
  );
  if (partial) return partial.nombre;
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const p of products) {
    const score = similarity(p.nombre.toLowerCase(), search.toLowerCase());
    if (score > bestScore && score > 0.5) {
      bestScore = score;
      bestMatch = p.nombre;
    }
  }
  
  return bestMatch;
}

function similarity(str1, str2) {
  const set1 = new Set(str1.split(''));
  const set2 = new Set(str2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

function getStatus(cantidad) {
  if (cantidad <= 1) return '🔴 CRÍTICO';
  if (cantidad <= 3) return '🟡 REPONER';
  return '🟢 OK';
}

async function processCommand(message, from) {
  const text = normalizeText(message);
  let response = '';
  
  // === COMANDOS ESPECIALES ===
  
  // Ver inventario
  if (text.includes('lista') || text.includes('ver') || text.includes('inventario') || text === 'listar') {
    const { data: products } = await supabase
      .from('productos')
      .select('*')
      .order('nombre');
    
    if (!products || products.length === 0) {
      return '📦 No hay productos en el inventario.';
    }
    
    response = '📋 *INVENTARIO ACTUAL*\n\n';
    for (const p of products) {
      const status = getStatus(p.cantidad);
      response += `• *${p.nombre}*: ${p.cantidad} unidades ${status}\n`;
    }
    response += `\n📊 *Total:* ${products.length} productos`;
    return response;
  }
  
  // Ver productos críticos
  if (text.includes('crítico') || text.includes('urgente') || text.includes('falta') && !text.includes('falta ')) {
    const { data: products } = await supabase
      .from('productos')
      .select('*')
      .lt('cantidad', 2);
    
    if (!products || products.length === 0) {
      return '✅ No hay productos críticos. Todo está bien! 🎉';
    }
    
    response = '🚨 *PRODUCTOS CRÍTICOS*\n\n';
    for (const p of products) {
      response += `• *${p.nombre}*: ${p.cantidad} unidades\n`;
    }
    response += '\n📝 *Lista del súper:*\n';
    for (const p of products) {
      response += `• ${p.nombre}\n`;
    }
    return response;
  }
  
  // Ver gastos
  if (text.includes('gasto') || text.includes('gastos')) {
    const { data: gastos } = await supabase
      .from('gastos')
      .select('*')
      .order('fecha', { ascending: false })
      .limit(5);
    
    const { data: totalGasto } = await supabase
      .from('gastos')
      .select('monto');
    
    let total = 0;
    if (totalGasto && totalGasto.length > 0) {
      total = totalGasto.reduce((sum, g) => sum + parseFloat(g.monto), 0);
    }
    
    response = '💰 *GASTOS REGISTRADOS*\n\n';
    if (gastos && gastos.length > 0) {
      for (const g of gastos) {
        response += `• ${g.fecha}: $${parseFloat(g.monto).toFixed(2)}\n`;
      }
    } else {
      response += 'No hay gastos registrados.\n';
    }
    response += `\n*Total gastado:* $${total.toFixed(2)}`;
    return response;
  }
  
  // Registrar gasto
  if (text.includes('gasté') && !text.includes('gasté un') || text.includes('gaste') && !text.includes('gaste un')) {
    const amountMatch = text.match(/\d+(\.\d+)?/);
    if (amountMatch) {
      const amount = parseFloat(amountMatch[0]);
      if (amount > 0) {
        const { error } = await supabase
          .from('gastos')
          .insert({
            monto: amount,
            fecha: new Date().toLocaleDateString('es-ES')
          });
        
        if (error) {
          return '❌ Error al registrar el gasto.';
        }
        
        return `✅ Gasto de $${amount.toFixed(2)} registrado correctamente.`;
      }
    }
    if (text.includes('gasté') || text.includes('gaste')) {
      return '❌ No pude identificar el monto. Ejemplo: "gasté 1500"';
    }
  }
  
  // === PROCESAR PRODUCTOS ===
  
  let action = '';
  let productName = '';
  let quantity = 1;
  
  // Detectar acción
  if (text.includes('compré') || text.includes('compre') || text.includes('comprar') || 
      text.includes('traje') || text.includes('agregué') || text.includes('añadí') ||
      text.includes('compro') || text.includes('compr')) {
    action = 'add';
    const extracted = extractQuantity(text);
    quantity = extracted.quantity;
    productName = extractProduct(extracted.cleanText);
  } 
  else if (text.includes('gasté') && text.includes('un') || text.includes('gaste') && text.includes('un') ||
           text.includes('consumí') || text.includes('usé') || text.includes('me comí') || 
           text.includes('me tomé') || text.includes('me acabé') || text.includes('utilicé') ||
           text.includes('gaste un') || text.includes('gasté un')) {
    action = 'subtract';
    const extracted = extractQuantity(text);
    quantity = extracted.quantity;
    productName = extractProduct(extracted.cleanText);
  }
  else if (text.includes('falta') || text.includes('faltan') || text.includes('necesito') ||
           text.includes('no hay') || text.includes('se acabó') || text.includes('acabó') ||
           text.includes('terminó') || text.includes('terminé')) {
    action = 'set_zero';
    productName = extractProduct(text);
  }
  
  // Si no se detectó acción pero hay texto
  if (!action && text.length > 2 && !['lista', 'ver', 'inventario', 'gastos', 'gasto', 'crítico', 'urgente'].some(word => text.includes(word))) {
    action = 'set_zero';
    productName = extractProduct(text);
  }
  
  if (!productName || productName.length < 2) {
    return '🤖 *Comandos disponibles:*\n\n' +
           '📦 *Productos:*\n' +
           '• "compré 2 leches" - Agregar\n' +
           '• "gasté un pan" - Restar\n' +
           '• "falta azúcar" - Marcar como 0\n' +
           '• "lista" - Ver inventario\n' +
           '• "crítico" - Ver urgentes\n\n' +
           '💰 *Gastos:*\n' +
           '• "gasté 1500" - Registrar gasto\n' +
           '• "gastos" - Ver historial';
  }
  
  // Buscar producto existente
  const existingProduct = await findSimilarProduct(productName);
  
  // Crear nuevo producto si no existe
  if (!existingProduct) {
    if (action === 'add' || action === 'set_zero') {
      const initialQuantity = action === 'add' ? quantity : 0;
      const { error } = await supabase
        .from('productos')
        .insert({
          nombre: productName,
          cantidad: initialQuantity,
          categoria: 'comida'
        });
      
      if (error) return `❌ No pude crear "${productName}"`;
      
      if (action === 'add') {
        return `📦 *Nuevo producto:* "${productName}" creado con ${quantity} unidades.`;
      } else {
        return `📦 *Nuevo producto:* "${productName}" creado. Recuerda comprarlo! 🛒`;
      }
    } else {
      const { error } = await supabase
        .from('productos')
        .insert({
          nombre: productName,
          cantidad: 0,
          categoria: 'comida'
        });
      
      if (error) return `❌ No pude crear "${productName}"`;
      
      return `📦 *Nuevo producto:* "${productName}" creado. No tienes unidades para gastar. 🛒`;
    }
  }
  
  // Procesar producto existente
  const { data: product } = await supabase
    .from('productos')
    .select('*')
    .eq('nombre', existingProduct)
    .single();
  
  if (!product) return `❌ Error al obtener "${existingProduct}"`;
  
  let newQuantity = product.cantidad;
  let responseMessage = '';
  
  switch (action) {
    case 'add':
      newQuantity = product.cantidad + quantity;
      responseMessage = `✅ *${existingProduct}*: +${quantity} (${product.cantidad} → ${newQuantity})`;
      break;
    case 'subtract':
      if (product.cantidad === 0) {
        return `⚠️ No hay *${existingProduct}* disponible. Tienes 0 unidades. 🛒 Agrégalo a la lista del súper!`;
      }
      newQuantity = Math.max(0, product.cantidad - quantity);
      responseMessage = `✅ *${existingProduct}*: -${quantity} (${product.cantidad} → ${newQuantity})`;
      break;
    case 'set_zero':
      if (product.cantidad === 0) {
        return `⚠️ *${existingProduct}* ya está en 0. 🛒 Agrégalo a la lista del súper!`;
      }
      newQuantity = 0;
      responseMessage = `⚠️ *${existingProduct}* marcado como faltante (${product.cantidad} → 0) 🛒`;
      break;
    default:
      return '❌ Acción no reconocida. Comandos: "compré", "gasté", "falta"';
  }
  
  // Actualizar en Supabase
  const { error } = await supabase
    .from('productos')
    .update({ 
      cantidad: newQuantity,
      updated_at: new Date().toISOString()
    })
    .eq('nombre', existingProduct);
  
  if (error) return `❌ Error al actualizar "${existingProduct}"`;
  
  if (newQuantity <= 1) {
    responseMessage += '\n\n🛒 *Agregar a lista del súper:* ' + existingProduct;
  }
  
  const status = getStatus(newQuantity);
  responseMessage += `\n📊 *Estado:* ${status}`;
  
  return responseMessage;
}

// ============ CONEXIÓN A WHATSAPP ============

async function connectWhatsApp() {
  const authFolder = './auth_info_baileys';
  const { state: authState, saveCreds } = await useMultiFileAuthState(authFolder);
  
  sock = makeWASocket({
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Stock Casa Bot', 'Chrome', '1.0.0']
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('📱 QR Code generado:');
      qrcode.generate(qr, { small: true });
      state.qrCode = qr;
      state.status = 'waiting_qr';
      console.log('✅ Escanea el QR con WhatsApp');
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Conexión cerrada, reconectando...');
      state.isConnected = false;
      state.status = 'disconnected';
      
      if (shouldReconnect) {
        setTimeout(() => connectWhatsApp(), 5000);
      }
    }
    
    if (connection === 'open') {
      console.log('✅ Conectado a WhatsApp!');
      state.isConnected = true;
      state.status = 'connected';
      state.qrCode = null;
    }
  });
  
  // Escuchar mensajes
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;
    
    const sender = msg.key.remoteJid;
    const messageText = msg.message.conversation || 
                        msg.message.extendedTextMessage?.text || 
                        msg.message.imageMessage?.caption ||
                        '';
    
    if (messageText) {
      console.log(`📩 Mensaje de ${sender}: ${messageText}`);
      const response = await processCommand(messageText, sender);
      await sock.sendMessage(sender, { text: response });
    }
  });
  
  state.sock = sock;
  return sock;
}

// ============ SERVERLESS FUNCTION ============

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Endpoint para obtener QR
  if (req.method === 'GET') {
    if (state.isConnected) {
      return res.status(200).json({
        status: 'connected',
        message: '✅ Bot conectado a WhatsApp',
        qr: null
      });
    }
    
    if (state.qrCode) {
      // Generar URL del QR (para mostrar en tu app)
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(state.qrCode)}`;
      return res.status(200).json({
        status: 'waiting_qr',
        message: '📱 Escanea el código QR con WhatsApp',
        qr: state.qrCode,
        qrImage: qrUrl,
        instructions: '1. Abre WhatsApp en tu teléfono\n2. Ve a Configuración > Dispositivos vinculados\n3. Escanea el código QR'
      });
    }
    
    if (!state.sock) {
      // Iniciar conexión
      try {
        await connectWhatsApp();
        return res.status(200).json({
          status: 'connecting',
          message: '🔄 Conectando a WhatsApp...'
        });
      } catch (error) {
        return res.status(500).json({
          status: 'error',
          message: '❌ Error al conectar: ' + error.message
        });
      }
    }
  }

  // Endpoint para enviar mensajes desde tu app
  if (req.method === 'POST' && req.path === '/send') {
    const { to, message } = req.body;
    
    if (!state.isConnected || !state.sock) {
      return res.status(400).json({
        error: '❌ Bot no conectado a WhatsApp'
      });
    }
    
    try {
      await state.sock.sendMessage(to, { text: message });
      return res.status(200).json({
        success: true,
        message: '✅ Mensaje enviado'
      });
    } catch (error) {
      return res.status(500).json({
        error: '❌ Error al enviar: ' + error.message
      });
    }
  }

  // Estado general
  if (req.method === 'GET' && req.path === '/status') {
    return res.status(200).json({
      status: state.status,
      isConnected: state.isConnected,
      hasQR: !!state.qrCode,
      timestamp: new Date().toISOString()
    });
  }

  // Respuesta por defecto
  return res.status(200).json({
    name: 'Stock Casa WhatsApp Bot',
    version: '1.0.0',
    endpoints: {
      'GET /': 'Información del bot',
      'GET /api/whatsapp': 'Obtener QR de conexión',
      'GET /api/whatsapp/status': 'Estado de la conexión',
      'POST /api/whatsapp/send': 'Enviar mensaje (to, message)'
    }
  });
};

// Iniciar conexión automáticamente
connectWhatsApp();