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
            description: "Performs a web search using Tavily API and returns relevant results",
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
                    message: {
                        type: "string",
                        description: "A message to display to the user after the web search has been performed"
                    },
                    requires_additional_tool: {
                        type: "boolean",
                        description: "Indicates if another tool will be needed after this execution to complete the task"
                    }
                },
                required: ["query", "message", "requires_additional_tool"]
            }
        }
    },
];

// Tool Implementations
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

function webSearch({ query, max_results = 5, search_depth = "basic", message, requires_additional_tool = false }) {
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
        const result = JSON.parse(response.getContentText());

        return {
            type: 1,
            message: message,
            data: result,
            nextTool: requires_additional_tool
        };
    } catch (error) {
        return {
            type: 3,
            message: `Failed to perform web search: ${error.message}`
        };
    }
}

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
            4. For images, use sheet.insertImage(image, column, row).
            5. For text, use sheet.getRange(row, column).setValue(text), **not setText()**.
            6. For formulas, use sheet.getRange(row, column).setFormula(formula).
            7. For data validation, use sheet.getRange(startRow, startColumn, numRows, numColumns).setDataValidation(rule).
            8. For conditional formatting, use sheet.getRange(startRow, startColumn, numRows, numColumns).setBackground(color) or setFontColor(color).
            9. For named ranges, use sheet.getRange(startRow, startColumn, numRows, numColumns).setName(name).
            10. For named formulas, use SpreadsheetApp.getActiveSpreadsheet().addNamedRange(name, sheet.getRange(startRow, startColumn, numRows, numColumns)).
            11. For named tables, use sheet.getRange(startRow, startColumn, numRows, numColumns).setValues(data) and optionally apply formatting.
            12. For named charts, create a chart as in point 2 and assign a name using sheet.getCharts().
            13. For named images, insert an image as in point 4 and rename manually if necessary.
            14. For named data validation, apply validation as in point 7 and save it under a named range if needed.
            15. For named conditional formatting, apply formatting as in point 8 and use an approach like named ranges if required.

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

function executeCode({ taskDescription, message, requires_additional_tool = false }) {
    try {
        // Generate code based on task description
        let generatedCode = codeGenerator(taskDescription);
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
                
                Error específico: ${evalError.message}
                
                Por favor, genera una versión corregida del código que resuelva este error.
                
                Tarea original: ${taskDescription}
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
