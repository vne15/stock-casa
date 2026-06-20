// ============================================================
// SERVIDOR PARA RENDER - VERSIÓN CORREGIDA
// ============================================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Configuración de Supabase
const supabase = createClient(
  'https://zzpfzqxiyszgkeqxmhrn.supabase.co',
  'sb_publishable_hr2KcUlqrhaWLIF8OM1-vA_lUJMCWCX'
);

console.log('🚀 Iniciando servidor...');
console.log('📦 Conectando a Supabase...');

// ============================================================
// RUTAS
// ============================================================

// Ruta principal
app.get('/', (req, res) => {
  res.json({
    name: 'Stock Casa WhatsApp Bot',
    status: 'online',
    version: '1.0.0',
    endpoints: {
      'GET /': 'Información del bot',
      'GET /api/whatsapp': 'Estado del bot',
      'POST /api/whatsapp': 'Procesar comandos (message, from)',
      'GET /api/test': 'Prueba de conexión'
    }
  });
});

// Ruta de prueba
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    message: '✅ API funcionando correctamente',
    timestamp: new Date().toISOString(),
    environment: 'Render'
  });
});

// Ruta para verificar estado
app.get('/api/whatsapp', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('productos')
      .select('nombre')
      .limit(1);

    if (error) {
      return res.json({
        status: 'error',
        message: 'Error de conexión a Supabase',
        detail: error.message
      });
    }

    res.json({
      status: 'connected',
      message: '✅ Bot de WhatsApp funcionando correctamente',
      supabase: 'conectado',
      productos: data ? data.length : 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

// Ruta para procesar comandos
app.post('/api/whatsapp', async (req, res) => {
  const { message, from } = req.body;
  
  if (!message) {
    return res.json({
      success: false,
      response: '❌ Envía un mensaje para procesar'
    });
  }

  try {
    const response = await processCommand(message);
    res.json({
      success: true,
      response: response
    });
  } catch (error) {
    res.json({
      success: false,
      response: '❌ Error al procesar: ' + error.message
    });
  }
});

// ============================================================
// FUNCIONES DE PROCESAMIENTO
// ============================================================

async function processCommand(message) {
  try {
    const text = message.toLowerCase().trim();
    
    // ===== COMANDO: LISTA =====
    if (text === 'lista' || text === 'listar' || text === 'inventario' || text === 'ver') {
      const { data, error } = await supabase
        .from('productos')
        .select('*')
        .order('nombre');
      
      if (error) return '❌ Error al obtener productos';
      if (!data || data.length === 0) return '📦 No hay productos en el inventario.';
      
      let response = '📋 *INVENTARIO ACTUAL*\n\n';
      for (const p of data) {
        const status = p.cantidad <= 1 ? '🔴' : p.cantidad <= 3 ? '🟡' : '🟢';
        response += `${status} *${p.nombre}*: ${p.cantidad} unidades\n`;
      }
      response += `\n📊 *Total:* ${data.length} productos`;
      return response;
    }
    
    // ===== COMANDO: CRÍTICO =====
    if (text === 'crítico' || text === 'critico' || text === 'urgente') {
      const { data, error } = await supabase
        .from('productos')
        .select('*')
        .lt('cantidad', 2);
      
      if (error) return '❌ Error al obtener productos críticos';
      if (!data || data.length === 0) return '✅ No hay productos críticos. Todo está bien! 🎉';
      
      let response = '🚨 *PRODUCTOS CRÍTICOS*\n\n';
      for (const p of data) {
        response += `🔴 *${p.nombre}*: ${p.cantidad} unidades\n`;
      }
      response += '\n📝 *Lista del súper:*\n';
      for (const p of data) {
        response += `• ${p.nombre}\n`;
      }
      return response;
    }
    
    // ===== COMANDO: GASTOS =====
    if (text === 'gastos' || text === 'gasto') {
      const { data, error } = await supabase
        .from('gastos')
        .select('*')
        .order('fecha', { ascending: false })
        .limit(5);
      
      const { data: totalData } = await supabase
        .from('gastos')
        .select('monto');
      
      let totalGasto = 0;
      if (totalData) {
        totalGasto = totalData.reduce((sum, g) => sum + parseFloat(g.monto || 0), 0);
      }
      
      let response = '💰 *GASTOS REGISTRADOS*\n\n';
      if (data && data.length > 0) {
        for (const g of data) {
          response += `• ${g.fecha}: $${parseFloat(g.monto).toFixed(2)}\n`;
        }
      } else {
        response += 'No hay gastos registrados.\n';
      }
      response += `\n*Total gastado:* $${totalGasto.toFixed(2)}`;
      return response;
    }
    
    // ===== COMANDO: COMPRÉ =====
    if (text.includes('compré') || text.includes('compre') || text.includes('comprar')) {
      let quantity = 1;
      let productName = '';
      
      const numMatch = text.match(/\b(\d+)\b/);
      if (numMatch) quantity = parseInt(numMatch[1]);
      
      let cleanText = text
        .replace(/compr[ée]|comprar|de|un|una|dos|tres|cuatro|cinco|\d+/g, '')
        .trim();
      productName = cleanText;
      
      if (!productName || productName.length < 2) {
        return '❌ No pude identificar el producto. Ejemplo: "compré 2 leches"';
      }
      
      const { data: existing, error: findError } = await supabase
        .from('productos')
        .select('*')
        .eq('nombre', productName)
        .maybeSingle();
      
      if (findError) return '❌ Error al buscar producto';
      
      if (existing) {
        const newQty = (existing.cantidad || 0) + quantity;
        const { error: updateError } = await supabase
          .from('productos')
          .update({ cantidad: newQty })
          .eq('nombre', productName);
        
        if (updateError) return '❌ Error al actualizar producto';
        
        return `✅ *${productName}*: +${quantity} (${existing.cantidad} → ${newQty})`;
      } else {
        const { error: insertError } = await supabase
          .from('productos')
          .insert({ 
            nombre: productName, 
            cantidad: quantity, 
            categoria: 'comida' 
          });
        
        if (insertError) return '❌ Error al crear producto';
        
        return `📦 *Nuevo producto:* "${productName}" creado con ${quantity} unidades.`;
      }
    }
    
    // ===== COMANDO: GASTÉ =====
    if (text.includes('gasté') || text.includes('gaste') || text.includes('consumí')) {
      let quantity = 1;
      let productName = '';
      
      const numMatch = text.match(/\b(\d+)\b/);
      if (numMatch) quantity = parseInt(numMatch[1]);
      
      let cleanText = text
        .replace(/gast[ée]|consum[íi]|de|un|una|dos|tres|cuatro|cinco|\d+/g, '')
        .trim();
      productName = cleanText;
      
      if (!productName || productName.length < 2) {
        return '❌ No pude identificar el producto. Ejemplo: "gasté un pan"';
      }
      
      const { data: existing, error: findError } = await supabase
        .from('productos')
        .select('*')
        .eq('nombre', productName)
        .maybeSingle();
      
      if (findError) return '❌ Error al buscar producto';
      
      if (!existing) {
        const { error: insertError } = await supabase
          .from('productos')
          .insert({ 
            nombre: productName, 
            cantidad: 0, 
            categoria: 'comida' 
          });
        
        if (insertError) return '❌ Error al crear producto';
        return `⚠️ *${productName}* no existía. Creado con 0 unidades. 🛒`;
      }
      
      if (existing.cantidad === 0) {
        return `⚠️ No hay *${productName}* disponible. Tienes 0 unidades. 🛒`;
      }
      
      const newQty = Math.max(0, existing.cantidad - quantity);
      const { error: updateError } = await supabase
        .from('productos')
        .update({ cantidad: newQty })
        .eq('nombre', productName);
      
      if (updateError) return '❌ Error al actualizar producto';
      
      let message = `✅ *${productName}*: -${quantity} (${existing.cantidad} → ${newQty})`;
      if (newQty <= 1) message += '\n\n🛒 *Agregar a lista del súper:* ' + productName;
      return message;
    }
    
    // ===== COMANDO: FALTA =====
    if (text.includes('falta') || text.includes('faltan') || text.includes('se acabó')) {
      let productName = text
        .replace(/falta|faltan|se acabó|de|un|una/g, '')
        .trim();
      
      if (!productName || productName.length < 2) {
        return '❌ No pude identificar el producto. Ejemplo: "falta azúcar"';
      }
      
      const { data: existing, error: findError } = await supabase
        .from('productos')
        .select('*')
        .eq('nombre', productName)
        .maybeSingle();
      
      if (findError) return '❌ Error al buscar producto';
      
      if (existing) {
        const { error: updateError } = await supabase
          .from('productos')
          .update({ cantidad: 0 })
          .eq('nombre', productName);
        
        if (updateError) return '❌ Error al actualizar producto';
        
        return `⚠️ *${productName}* marcado como faltante (${existing.cantidad} → 0) 🛒`;
      } else {
        const { error: insertError } = await supabase
          .from('productos')
          .insert({ 
            nombre: productName, 
            cantidad: 0, 
            categoria: 'comida' 
          });
        
        if (insertError) return '❌ Error al crear producto';
        
        return `📦 *Nuevo producto:* "${productName}" creado como faltante 🛒`;
      }
    }
    
    // ===== COMANDO: GASTÉ $ =====
    if ((text.includes('gasté') || text.includes('gaste')) && /\$?\d+/.test(text)) {
      const match = text.match(/\$?(\d+(\.\d+)?)/);
      if (match) {
        const amount = parseFloat(match[1]);
        if (amount > 0) {
          const { error } = await supabase
            .from('gastos')
            .insert({
              monto: amount,
              fecha: new Date().toLocaleDateString('es-ES')
            });
          
          if (error) return '❌ Error al registrar gasto';
          return `✅ Gasto de $${amount.toFixed(2)} registrado correctamente.`;
        }
      }
      return '❌ No pude identificar el monto. Ejemplo: "gasté 1500"';
    }
    
    // ===== AYUDA =====
    return '🤖 *Comandos disponibles:*\n\n' +
      '📦 *Productos:*\n' +
      '• "compré 2 leches" - Agregar\n' +
      '• "gasté un pan" - Restar\n' +
      '• "falta azúcar" - Marcar faltante\n' +
      '• "lista" - Ver inventario\n' +
      '• "crítico" - Ver urgentes\n\n' +
      '💰 *Gastos:*\n' +
      '• "gasté 1500" - Registrar gasto\n' +
      '• "gastos" - Ver historial';
      
  } catch (error) {
    console.error('❌ Error en processCommand:', error);
    return '❌ Error al procesar el comando. Intenta de nuevo.';
  }
}

// ============================================================
// INICIAR SERVIDOR - PARTE CRÍTICA CORREGIDA
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📱 WhatsApp Bot API en /api/whatsapp`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
});

// Manejar errores no capturados
process.on('uncaughtException', (err) => {
  console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Promesa rechazada:', err);
});
