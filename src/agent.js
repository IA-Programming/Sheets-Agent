// *------------  SYSTEM PROMPTS  ------------ * //

const SYSTEM_PROMPTS = {
    default: `You are a helpful spreadsheet assistant that helps users work with Google Sheets.
           You can perform various tasks like data analysis, formatting, and calculations.`,

    toolExecution: `Role: GridPilot, A spreadsheet assistant   
            Goal: Select the most appropriate tool to complete the user's request within a spreadsheet environment.  
            Context:  
            - You have access to tools that can manipulate spreadsheet data, execute Google Apps Script code, and perform web searches.  
            - The user may ask for tasks related to modifying cells, retrieving data, formatting, automating processes, or integrating external information.  
            - Your role is to determine which tool should be used and configure its parameters.  
            - If a previous tool's response included "requires_additional_tool": true, you must continue the process by selecting the next best tool.  
            - You must always prioritize solving the request in the fewest steps possible.  

            Instructions:  
            1. Analyze the conversation history to understand the user's request.
            2. Identify if a tool is required to fulfill the request.
            3. If this is a continuation of a previous tool's execution, choose the next necessary tool.
            4. Respond using the following JSON structure:  
            {
            "name": "tool_name",
            "arguments": { "key": "value", ... }
            }`
};

// *------------  GRANITE API INTERACTION  ------------ * //

function apiRequest(messages, tools = null, toolChoice = null, responseFormat = null) {
    const settings = getUserSettings();
    const tokenResponse = getAccessToken();

    if (tokenResponse.type !== 1) {
        throw new Error(tokenResponse.message);
    }

    const url = `${settings.apiUrl}/ml/v1/text/chat?version=2023-10-25`;
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenResponse.accessToken}`
    };

    const body = {
        model_id: settings.model,
        project_id: settings.projectId,
        max_tokens: 5120,
        messages,
        ...(tools && { tools }),
        ...(toolChoice && { tool_choice: toolChoice }),
        ...(responseFormat && { response_format: responseFormat })
    };

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'POST',
            headers: headers,
            payload: JSON.stringify(body),
            muteHttpExceptions: true
        });

        const responseData = JSON.parse(response.getContentText());

        if (response.getResponseCode() !== 200) {
            throw new Error(`API request failed: ${responseData.error || 'Unknown error'}`);
        }

        return responseData;
    } catch (error) {
        console.error('Error in API request:', error);
        throw error;
    }
}

// *------------  CHAT HISTORY MANAGEMENT  ------------ * //

function saveToHistory(messages) {
    const userProps = PropertiesService.getUserProperties();
    const history = JSON.parse(userProps.getProperty('CHAT_HISTORY') || '[]');
    history.push(...messages);
    userProps.setProperty('CHAT_HISTORY', JSON.stringify(history));
}

function getHistory() {
    const userProps = PropertiesService.getUserProperties();
    const history = JSON.parse(userProps.getProperty('CHAT_HISTORY') || '[]');

    // Filtrar mensajes del sistema y formatear el contenido
    return history.filter(message => {
        // Excluir mensajes del sistema
        if (message.role === 'system') return false;

        // Formatear contenido de arrays a string
        if (message.content && Array.isArray(message.content)) {
            message.content = message.content
                .map(item => item.text || item)
                .join('\n');
        }

        return true;
    });
}

function clearHistory() {
    PropertiesService.getUserProperties().deleteProperty('CHAT_HISTORY');
}

// *------------  MAIN FUNCTIONS  ------------ * //

function isGreeting(response) {
    const content = response.choices?.[0]?.message?.content;
    if (!content) return false;

    try {
        // Then check for direct greeting patterns
        const greetingPatterns = [
            /^(👋|🤖)?\s*(hi|hello|hey|hola|greetings)/i,
            /^(👋|🤖)?\s*(good\s*(morning|afternoon|evening))/i,
            /how can I (help|assist) you.*spreadsheet/i,
            /welcome.*spreadsheet assistant/i
        ];

        return greetingPatterns.some(pattern => pattern.test(content));
    } catch (error) {
        console.error('Error checking greeting:', error);
        return false;
    }
}

function selectTool(request) {
    try {
        const { query, attachments = null, isContinuation = false } = request;
        const history = getHistory();

        // Check if this is a continuation from previous tool execution
        const lastMessage = history[history.length - 1];

        // For continuations, we don't need to add the query again
        const messages = isContinuation ?
            buildInitialMessages(null, history, SYSTEM_PROMPTS.toolExecution) :
            buildInitialMessages(query, history, SYSTEM_PROMPTS.toolExecution);

        console.log('MESSAGES', messages);

        const response = apiRequest(messages, tools.definitions);

        console.log('RESPONSE', JSON.stringify(response));

        // Check for direct greeting response
        if (isGreeting(response)) {
            const message = response.choices[0].message.content;

            // Save as assistant message
            saveToHistory([{
                role: "assistant",
                content: message
            }]);

            return {
                type: 1,
                message: message,
                finished: true
            };
        }

        const toolCall = extractToolCall(response);

        console.log('TOOL CALL', toolCall);

        if (!toolCall || toolCall.type !== 'function') {
            return {
                type: 1,
                message: "I cannot help with that request",
                finished: true
            };
        }

        // Special handling for greeting tool
        if (toolCall.function.name === 'greeting') {
            const params = JSON.parse(toolCall.function.arguments);
            const result = executeToolCall(tools.implementations.greeting, params);

            // Save only as an assistant message
            saveToHistory([{
                role: "assistant",
                content: result.message
            }]);

            return {
                type: 1,
                message: result.message,
                finished: true
            };
        }

        // Regular tool handling
        if (!isContinuation && query) {
            saveToHistory([{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: query
                    }
                ]
            }
            ]);
        }

        return {
            type: 1,
            message: `Using ${toolCall.function.name} to help you`,
            tool: {
                name: toolCall.function.name,
                parameters: JSON.parse(toolCall.function.arguments),
                description: `Execute ${toolCall.function.name}`
            }
        };

    } catch (error) {
        return formatErrorResponse(error);
    }
}

function executeTool(toolRequest) {
    try {
        const { name, parameters } = toolRequest;

        // Validate tool exists
        const toolFunction = tools.implementations[name];
        if (!toolFunction) {
            throw new Error(`Tool ${name} not implemented`);
        }

        // Execute the tool
        const result = executeToolCall(toolFunction, parameters);

        // Save result to history
        saveToHistory([{
            role: 'tool',
            content: result?.output,
            tool_call_id: name
        },
        {
            role: 'assistant',
            content: result.message
        }
        ]);

        return result;

    } catch (error) {
        return formatErrorResponse(error);
    }
}

// *------------  TOOL EXECUTION  ------------ * //
function executeToolCall(toolFunction, params) {
    try {
        const result = toolFunction(params);
        return {
            type: 1,
            message: result.message,
            output: result.data
        };
    } catch (error) {
        return {
            type: 3,
            message: `Error: ${error.message}`
        };
    }
}

// *------------  HELPER FUNCTIONS  ------------ * //

function buildInitialMessages(query, history = [], systemPrompt = SYSTEM_PROMPTS.default) {
    // Ensure the first message is always the updated systemPrompt
    const updatedSystemMessage = {
        role: "system",
        content: `${systemPrompt} ${getUserSettings().customInstructions || ''}`
    };

    // Remove the first message if history exists and starts with a system prompt
    if (history.length > 0 && history[0].role === "system") {
        history[0] = updatedSystemMessage;
    } else {
        history.unshift(updatedSystemMessage);
    }

    // Construct the final messages array
    const messages = [...history];

    // Add query only if provided
    if (query) {
        messages.push({
            role: "user",
            content: [
                {
                    type: "text",
                    text: query
                }
            ]
        });
    }

    return messages;
}

function formatErrorResponse(error) {
    return {
        type: 3,
        message: `Error: ${error.message}`,
        error: error.toString()
    };
}

function extractToolCall(response) {
    // Check if toolCall is in the standard format
    const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) {
        return toolCall;
    }

    // Check if toolCall is in the alternative format
    const content = response.choices?.[0]?.message?.content;
    if (!content) return null;

    try {
        // Check for multiple tool calls format
        const toolCalls = content.split(/\n\s*\n/)
            .map(block => {
                // Try to extract tool name and JSON
                const toolMatch = block.match(/^(\w+)\s*\n\s*(\{[\s\S]*\})/);
                if (toolMatch) {
                    const [_, toolName, jsonStr] = toolMatch;
                    try {
                        const params = JSON.parse(jsonStr);
                        return {
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments: JSON.stringify(params)
                            }
                        };
                    } catch (e) {
                        console.error('Error parsing JSON for tool:', toolName, e);
                        return null;
                    }
                }
                return null;
            })
            .filter(Boolean);

        if (toolCalls.length > 0) {
            // Return the first valid tool call
            return toolCalls[0];
        }

        // Try to parse direct JSON from content
        if (content.includes('"name"') && content.includes('"arguments"')) {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsedJson = JSON.parse(jsonMatch[0]);
                return {
                    type: 'function',
                    function: {
                        name: parsedJson.name,
                        arguments: JSON.stringify(parsedJson.arguments)
                    }
                };
            }
        }

        // Check for tool_call format
        if (content.includes('<tool_call>')) {
            const toolCallStr = content.match(/<tool_call>\[(.*?)\]/)?.[1];
            if (toolCallStr) {
                const args = JSON.parse(toolCallStr);
                return {
                    type: 'function',
                    function: {
                        name: Object.keys(tools.implementations).find(name =>
                            Object.keys(tools.definitions.find(t =>
                                t.function.name === name)?.function.parameters.properties || {})
                                .every(param => param in args.arguments)
                        ),
                        arguments: JSON.stringify(args.arguments)
                    }
                };
            }
        }
    } catch (error) {
        console.error('Error parsing tool call:', error);
    }

    return null;
}