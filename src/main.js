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
function saveUserSettings(apiKey, model, customInstructions, apiUrl, projectId, tavilyApiKey) {
  var userProps = PropertiesService.getUserProperties();
  userProps.setProperty("API_PROVIDER", "ibm-granite");
  userProps.setProperty("PROJECT_ID", projectId);
  userProps.setProperty("API_URL", apiUrl);
  userProps.setProperty("API_KEY", apiKey);
  userProps.setProperty("TAVILY_API_KEY", tavilyApiKey);
  userProps.setProperty("MODEL", model);
  userProps.setProperty("CUSTOM_INSTRUCTIONS", customInstructions);
}

function getUserSettings() {
  var userProps = PropertiesService.getUserProperties();
  return {
    apiProvider: userProps.getProperty("API_PROVIDER"),
    projectId: userProps.getProperty("PROJECT_ID"),
    apiUrl: userProps.getProperty("API_URL"),
    apiKey: userProps.getProperty("API_KEY"),
    tavilyApiKey: userProps.getProperty("TAVILY_API_KEY"),
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