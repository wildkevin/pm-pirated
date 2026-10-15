// Postman's script snippets (the list next to the script editor).
export interface Snippet {
  label: string
  code: string
  tests?: boolean
}

export const SNIPPETS: Snippet[] = [
  { label: 'Get an environment variable', code: 'pm.environment.get("variable_key");' },
  { label: 'Get a global variable', code: 'pm.globals.get("variable_key");' },
  { label: 'Get a variable', code: 'pm.variables.get("variable_key");' },
  { label: 'Get a collection variable', code: 'pm.collectionVariables.get("variable_key");' },
  { label: 'Set an environment variable', code: 'pm.environment.set("variable_key", "variable_value");' },
  { label: 'Set a global variable', code: 'pm.globals.set("variable_key", "variable_value");' },
  { label: 'Set a collection variable', code: 'pm.collectionVariables.set("variable_key", "variable_value");' },
  { label: 'Clear an environment variable', code: 'pm.environment.unset("variable_key");' },
  { label: 'Clear a global variable', code: 'pm.globals.unset("variable_key");' },
  { label: 'Clear a collection variable', code: 'pm.collectionVariables.unset("variable_key");' },
  {
    label: 'Send a request',
    code: 'pm.sendRequest("https://postman-echo.com/get", function (err, response) {\n    console.log(response.json());\n});',
  },
  { label: 'Status code: Code is 200', tests: true, code: 'pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});' },
  {
    label: 'Response body: Contains string',
    tests: true,
    code: 'pm.test("Body matches string", function () {\n    pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});',
  },
  {
    label: 'Response body: JSON value check',
    tests: true,
    code: 'pm.test("Your test name", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.value).to.eql(100);\n});',
  },
  {
    label: 'Response body: Is equal to a string',
    tests: true,
    code: 'pm.test("Body is correct", function () {\n    pm.response.to.have.body("response_body_string");\n});',
  },
  {
    label: 'Response headers: Content-Type header check',
    tests: true,
    code: 'pm.test("Content-Type is present", function () {\n    pm.response.to.have.header("Content-Type");\n});',
  },
  {
    label: 'Response time is less than 200ms',
    tests: true,
    code: 'pm.test("Response time is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});',
  },
  {
    label: 'Status code: Successful POST request',
    tests: true,
    code: 'pm.test("Successful POST request", function () {\n    pm.expect(pm.response.code).to.be.oneOf([201, 202]);\n});',
  },
  {
    label: 'Status code: Code name has string',
    tests: true,
    code: 'pm.test("Status code name has string", function () {\n    pm.response.to.have.status("Created");\n});',
  },
  {
    label: 'Response body: Convert XML body to a JSON Object',
    tests: true,
    code: 'var jsonObject = xml2Json(responseBody);',
  },
]

export const snippetsFor = (target: 'prerequest' | 'test') => SNIPPETS.filter((s) => target === 'test' || !s.tests)

/** pm.* names offered by the script editor's autocomplete. */
export const PM_COMPLETIONS = [
  'pm.environment.get',
  'pm.environment.set',
  'pm.environment.unset',
  'pm.globals.get',
  'pm.globals.set',
  'pm.globals.unset',
  'pm.collectionVariables.get',
  'pm.collectionVariables.set',
  'pm.collectionVariables.unset',
  'pm.variables.get',
  'pm.variables.set',
  'pm.variables.replaceIn',
  'pm.request.url',
  'pm.request.headers.add',
  'pm.request.headers.upsert',
  'pm.request.headers.remove',
  'pm.request.body',
  'pm.response.code',
  'pm.response.status',
  'pm.response.headers',
  'pm.response.responseTime',
  'pm.response.json',
  'pm.response.text',
  'pm.response.to.have.status',
  'pm.response.to.have.header',
  'pm.response.to.have.body',
  'pm.response.to.be.ok',
  'pm.test',
  'pm.expect',
  'pm.sendRequest',
  'pm.cookies.get',
  'pm.cookies.has',
  'pm.info.requestName',
  'pm.info.iteration',
  'pm.execution.skipRequest',
  'pm.execution.setNextRequest',
  'pm.visualizer.set',
]
