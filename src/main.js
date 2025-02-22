function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GridPilot')
    .addItem('Open Chat', 'showChatSidebar')
    .addToUi();
}

function showChatSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('views/chat')
    .setTitle('GridPilot Chat');

  SpreadsheetApp.getUi().showSidebar(html);
}

function selectTool(request) {
  // request debe contener:
  // - query: el mensaje original del usuario
  // - history: historial de mensajes
  // - attachments: archivos adjuntos del mensaje actual
  // - previousToolOutput: resultado de la herramienta anterior (si existe)
  // - step: paso actual del proceso

  // Mock: Simular dos flujos diferentes basados en el step
  if (request.step === 1) {
    return {
      message: "I'll help you find and write the top songs. First, I need to search for them.",
      tool: {
        name: "search",
        description: "Search for specific data",
        parameters: {
          query: request.query,
          limit: 10
        }
      }
    };
  } else {
    // Usar previousToolOutput para la siguiente herramienta
    const previousData = request.previousToolOutput?.output || ["Song 1", "Song 2", "Song 3"];
    
    return {
      message: "Great, I found the songs. Now I'll write them to the spreadsheet.",
      tool: {
        name: "write",
        description: "Write data to spreadsheet",
        parameters: {
          range: "A1:A10",
          data: previousData
        }
      }
    };
  }
}

function executeTool(toolRequest) {
  // toolRequest contiene la herramienta seleccionada con:
  // - name: nombre de la herramienta
  // - parameters: parámetros necesarios
  // - description: descripción de la herramienta
  
  const results = {
    search: {
      output: ["Top Song 1", "Top Song 2", "Top Song 3"],
      message: "I've found the songs. Let me write them to your spreadsheet.",
      nextTool: true
    },
    write: {
      output: "Data written to A1:A10",
      message: "I've written all the songs to your spreadsheet. You can find them in cells A1 through A10.",
      nextTool: false
    }
  };

  return results[toolRequest.name];
}

function clearChatHistory() {
  return true;
} 