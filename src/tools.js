// Tool Definitions
const toolDefinitions = [
    {
        type: "function",
        function: {
            name: "greeting",
            description: "Provides a friendly greeting response to the user",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Name to greet (optional)",
                    },
                    language: {
                        type: "string",
                        description: "Language for the greeting (default: English)",
                        enum: ["en", "es"]
                    },
                },
            }
        }
    },
    {
        type: "function",
        function: {
            name: "executeCode",
            description: "Generates and executes Google Apps Script code based on instructions to manipulate the active spreadsheet",
            parameters: {
                type: "object",
                properties: {
                    taskDescription: {
                        type: "string",
                        description: "Clear description of what the code should do. For example: 'Copy data from range A1:B10 to range D1:E10' or 'Create a chart using data from A1:B10'"
                    },
                    message: {
                        type: "string",
                        description: "A message to display to the user after the code has been executed"
                    },
                    additionalInfo: {
                        type: "object",
                        description: "additional information needed to complete the task (like search results, data from other tools, information from the user, etc)",
                    },
                    requires_additional_tool: {
                        type: "boolean",
                        description: "Indicates if another tool will be needed after this execution to complete the task"
                    }
                },
                required: ["taskDescription", "message", "requires_additional_tool"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "webSearch",
            description: "Performs a web search using Tavily API and returns relevant results with an AI-generated response",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query to look up.",
                    },
                    max_results: {
                        type: "number",
                        description: "Maximum number of results to return (default: 5)",
                    },
                    search_depth: {
                        type: "string",
                        enum: ["basic", "advanced"],
                        description: "Depth of search - basic is faster, advanced is more thorough",
                    },
                    requires_additional_tool: {
                        type: "boolean",
                        description: "Indicates if another tool will be needed after this execution to complete the task"
                    }
                },
                required: ["query", "requires_additional_tool"]
            }
        }
    },
];

// *------------  GREETING  ------------ * //

function greeting({ name = '', language = 'en' }) {
    const greetings = {
        en: {
            default: "Hello! I'm GridPilot, your spreadsheet assistant. How can I help you today?",
            named: `Hello ${name}! I'm GridPilot, your spreadsheet assistant. How can I help you today?`
        },
        es: {
            default: "¡Hola! Soy GridPilot, tu asistente de hojas de cálculo. ¿En qué puedo ayudarte hoy?",
            named: `¡Hola ${name}! Soy GridPilot, tu asistente de hojas de cálculo. ¿En qué puedo ayudarte hoy?`
        }
    };

    const message = name ?
        greetings[language].named :
        greetings[language].default;

    return {
        type: 1,
        message: message,
        data: { greeted: true },
    };
}

// *------------  WEB SEARCH  ------------ * //

function generateSearchResponse(query, searchResults) {
    const settings = getUserSettings();
    const tokenResponse = getAccessToken();

    if (tokenResponse.type !== 1) {
        throw new Error(tokenResponse.message);
    }

    const url = `${settings.apiUrl}/ml/v1/text/generation?version=2023-05-29`;
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenResponse.accessToken}`
    };

    const systemPrompt = `
        Role: You are a helpful AI assistant that summarizes web search results.
        Task: Generate a brief, direct response to the user's query using the search results provided.
        Guidelines:
        - Keep responses concise and focused on answering the query
        - Prioritize the most relevant information
        - Use natural, conversational language
        - Avoid unnecessary details or explanations
        - If search results don't answer the query, say so clearly

        User Query: ${query}
        Search Results: ${JSON.stringify(searchResults)}

        Response:`;

    const body = {
        input: systemPrompt,
        parameters: {
            decoding_method: "greedy",
            max_new_tokens: 900,
            min_new_tokens: 0,
            stop_sequences: [],
            repetition_penalty: 1
        },
        model_id: "ibm/granite-3-8b-instruct",
        project_id: settings.projectId,
        moderations: {
            hap: {
                input: { enabled: true, threshold: 0.5, mask: { remove_entity_value: true } },
                output: { enabled: true, threshold: 0.5, mask: { remove_entity_value: true } }
            },
            pii: {
                input: { enabled: true, threshold: 0.5, mask: { remove_entity_value: true } },
                output: { enabled: true, threshold: 0.5, mask: { remove_entity_value: true } }
            }
        }
    };

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'POST',
            headers: headers,
            payload: JSON.stringify(body),
            muteHttpExceptions: true
        });

        const responseText = response.getContentText();
        console.log('API Response:', responseText);

        if (response.getResponseCode() !== 200) {
            throw new Error(`API request failed with status ${response.getResponseCode()}`);
        }

        const responseData = JSON.parse(responseText);
        const generatedResponse = responseData.results?.[0]?.generated_text;

        if (!generatedResponse) {
            throw new Error('No response was generated');
        }

        return generatedResponse.trim();
    } catch (error) {
        console.error('Error generating search response:', error);
        throw error;
    }
}

function webSearch({ query, max_results = 5, search_depth = "basic", requires_additional_tool = false }) {
    const settings = getUserSettings();
    const tavilyApiKey = settings.tavilyApiKey;

    if (!tavilyApiKey) {
        return {
            type: 3,
            message: "Tavily API Key not configured"
        };
    }

    const apiUrl = 'https://api.tavily.com/search';
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tavilyApiKey}`
        },
        payload: JSON.stringify({
            query,
            max_results,
            search_depth,
            include_answer: true,
            include_images: false,
            include_raw_content: false,
        })
    };

    try {
        const response = UrlFetchApp.fetch(apiUrl, options);
        const searchResults = JSON.parse(response.getContentText());

        return {
            type: 1,
            message: searchResults.answer,
            data: JSON.stringify(searchResults.results),
            nextTool: requires_additional_tool
        };
    } catch (error) {
        return {
            type: 3,
            message: `Failed to perform web search: ${error.message}`
        };
    }
}

// *------------  CODE GENERATION  ------------ * //

function codeGenerator(description) {
    const settings = getUserSettings();
    const tokenResponse = getAccessToken();

    if (tokenResponse.type !== 1) {
        throw new Error(tokenResponse.message);
    }

    const url = `${settings.apiUrl}/ml/v1/text/generation?version=2023-05-29`;
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenResponse.accessToken}`
    };

    const systemPrompt = `
        Role: You are an intelligent AI programming assistant specializing in Google Apps Script.
        Goal: Generate the shortest possible Google Apps Script function that edits the current Google Spreadsheet as described below. Ensure the code is self-contained (self-invoking function), without comments, and directly executable to achieve the task. If any data is not specified, assume reasonable defaults.
        Instructions:
            1. If no specific sheet is mentioned, work with the active sheet (SpreadsheetApp.getActive().getActiveSheet()).
            2. For charts, use sheet.newChart().addRange(sheet.getRange(startRow, startColumn, numRows, numColumns)).setPosition(row, column, offsetX, offsetY).build(), then insert with sheet.insertChart(chart).
            3. For tables, use sheet.getRange(startRow, startColumn, numRows, numColumns).setValues(data), **not sheet.newTable()**.
            4. Always check that the data array matches the range size exactly (getRange(1, 1, 6, 1).setValues([['data_1'], ..., ['data_6']]));
            5. For images, use sheet.insertImage(image, column, row).
            6. For text, use sheet.getRange(row, column).setValue(text), **not setText()**.
            7. For formulas, use sheet.getRange(row, column).setFormula(formula).
            8. For data validation, use sheet.getRange(startRow, startColumn, numRows, numColumns).setDataValidation(rule).
            9. For conditional formatting, use sheet.getRange(startRow, startColumn, numRows, numColumns).setBackground(color) or setFontColor(color).
            10. For named ranges, use sheet.getRange(startRow, startColumn, numRows, numColumns).setName(name).
            11. For named formulas, use SpreadsheetApp.getActiveSpreadsheet().addNamedRange(name, sheet.getRange(startRow, startColumn, numRows, numColumns)).
            12. For named tables, use sheet.getRange(startRow, startColumn, numRows, numColumns).setValues(data) and optionally apply formatting.
            13. For named charts, create a chart as in point 2 and assign a name using sheet.getCharts().
            14. For named images, insert an image as in point 5 and rename manually if necessary.
            15. For named data validation, apply validation as in point 8 and save it under a named range if needed.
            16. For named conditional formatting, apply formatting as in point 9 and use an approach like named ranges if required.
        Task:
        ${description}

        Code:`;

    const body = {
        input: systemPrompt,
        parameters: {
            decoding_method: "greedy",
            max_new_tokens: 900,
            min_new_tokens: 0,
            stop_sequences: [],
            repetition_penalty: 1
        },
        model_id: "ibm/granite-34b-code-instruct",
        project_id: settings.projectId
    };

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'POST',
            headers: headers,
            payload: JSON.stringify(body),
            muteHttpExceptions: true
        });

        const responseText = response.getContentText();
        console.log('API Response:', responseText);

        if (response.getResponseCode() !== 200) {
            throw new Error(`API request failed with status ${response.getResponseCode()}`);
        }

        const responseData = JSON.parse(responseText);
        const improvedCode = responseData.results?.[0]?.generated_text;

        if (!improvedCode) {
            throw new Error('No code was generated');
        }

        return improvedCode;
    } catch (error) {
        console.error('Error in improveCode:', error);
        throw error;
    }
}

function executeCode({ taskDescription, message, additionalInfo = null, requires_additional_tool = false }) {
    try {
        // Generate code based on task description and additional info
        let generatedCode = codeGenerator(
            additionalInfo ?
                `${taskDescription}\n\nAdditional Information: ${JSON.stringify(additionalInfo)}` :
                taskDescription
        );
        console.log('Generated code:', generatedCode);

        // Check if code is a function declaration
        const functionMatch = generatedCode.match(/function\s+(\w+)\s*\([^\)]*\)\s*\{([\s\S]*)\}/);

        if (functionMatch) {
            // Extract function name and body
            const [_, functionName, functionBody] = functionMatch;

            // Create and execute the function
            generatedCode = `
                (function() {
                    function ${functionName}() {
                        ${functionBody}
                    }
                    return ${functionName}();
                })();
            `;
        }

        let result;
        try {
            // Execute the generated code in a separate try-catch
            result = eval(generatedCode);
        } catch (evalError) {
            // If there is an error in execution, we generate new code with the error
            const errorDescription = `
                The following code generated an error: 
                ${generatedCode}
                
                Specific error: ${evalError.message}
                
                Please generate a corrected version of the code that resolves this error.
                
                Original task: ${taskDescription}
            `;

            // We try to generate corrected code
            const correctedCode = codeGenerator(errorDescription);

            // We try to execute the corrected code
            try {
                result = eval(correctedCode);
                return {
                    type: 1,
                    message: message,
                    data: correctedCode,
                    nextTool: requires_additional_tool
                };
            } catch (finalError) {
                return {
                    type: 3,
                    data: correctedCode,
                    message: `Failed to execute code after correction attempt: ${finalError.message}`
                };
            }
        }

        return {
            type: 1,
            message: message,
            data: generatedCode,
            nextTool: requires_additional_tool
        };
    } catch (error) {
        return {
            type: 3,
            data: taskDescription,
            message: `Failed to generate code: ${error.message}`
        };
    }
}

// Export the tools
const tools = {
    definitions: toolDefinitions,
    implementations: {
        greeting,
        webSearch,
        executeCode
    }
};
