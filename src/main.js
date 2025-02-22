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

// USER SETTINGS
function saveUserSettings(apiKey, model, customInstructions) {
  var userProps = PropertiesService.getUserProperties();
  userProps.setProperty("API_PROVIDER", "granite-ibm");
  userProps.setProperty("API_KEY", apiKey);
  userProps.setProperty("MODEL", model);
  userProps.setProperty("CUSTOM_INSTRUCTIONS", customInstructions);
}

function getUserSettings() {
  var userProps = PropertiesService.getUserProperties();
  return {
    apiProvider: userProps.getProperty("API_PROVIDER"),
    apiKey: userProps.getProperty("API_KEY"),
    model: userProps.getProperty("MODEL"),
    customInstructions: userProps.getProperty("CUSTOM_INSTRUCTIONS")
  };
}

function getAccessToken() {
  var userProps = PropertiesService.getUserProperties();
  var apiKey = userProps.getProperty("API_KEY");
  var accessToken = userProps.getProperty("ACCESS_TOKEN");
  var expiration = userProps.getProperty("TOKEN_EXPIRATION");
  var now = Math.floor(new Date().getTime() / 1000);

  if (!apiKey) {
    return { type: 3, message: "Error: API Key is not configured." };
  }

  // Refresh the token 2 minutes before expiration
  if (accessToken && expiration && now < parseInt(expiration) - 120) {
    return { type: 1, message: "Success", accessToken: accessToken };
  }

  var url = "https://iam.cloud.ibm.com/identity/token";
  var payload = "grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=" + encodeURIComponent(apiKey);

  var options = {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: payload
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());

    if (json.access_token) {
      userProps.setProperty("ACCESS_TOKEN", json.access_token);
      userProps.setProperty("TOKEN_EXPIRATION", json.expiration.toString());
      return { type: 1, message: "Success", accessToken: json.access_token };
    } else {
      return { type: 3, message: "IBM did not return an access token." };
    }
  } catch (e) {
    return { type: 3, message: "Error retrieving token" };
  }
}

// AGENT 

async function getAgentResponse(request) {
  const { query, history, attachments, previousToolOutput, step } = request;

  const agent = new Agent({
    model: getUserSettings().model,
    customInstructions: getUserSettings().customInstructions
  });

  const response = await agent.run(query, {
    history,
    attachments,
    previousToolOutput
  });

  return response;
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

// CHAT HISTORY
function clearChatHistory() {
  return true;
} 