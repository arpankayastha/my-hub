import { op, jsonBody, idParam } from '../helpers.js';

export function tasksPaths() {
  return {
    '/api/v1/tasks': {
      get: op({ summary: 'List tasks', tag: 'Tasks' }),
      post: op({ summary: 'Create task', tag: 'Tasks', stateChanging: true, requestBody: jsonBody(null) }),
    },
    '/api/v1/tasks/meta/options': { get: op({ summary: 'Get task metadata', tag: 'Tasks' }) },
    '/api/v1/tasks/points/affected': {
      get: op({ summary: 'Count unfinished tasks on a given point value', tag: 'Tasks', description: 'Admin only. Preview for the default-points rebase: top-level tasks that are not done and whose points equal the query value.' }),
    },
    '/api/v1/tasks/points/rebase': {
      post: op({ summary: 'Move unfinished tasks from one point value to another', tag: 'Tasks', stateChanging: true, requestBody: jsonBody(null), description: 'Admin only. Applies a changed default point value to top-level tasks that still carry the previous default. Tasks in status done keep their value because the reward ledger already holds an earn entry for it.' }),
    },
    '/api/v1/tasks/categories': {
      get: op({ summary: 'List task categories', tag: 'Tasks' }),
      post: op({ summary: 'Create task category', tag: 'Tasks', stateChanging: true, requestBody: jsonBody(null) }),
    },
    '/api/v1/tasks/categories/reorder': {
      patch: op({ summary: 'Reorder task categories', tag: 'Tasks', stateChanging: true, requestBody: jsonBody(null) }),
    },
    '/api/v1/tasks/categories/{key}': {
      put: op({ summary: 'Rename task category', tag: 'Tasks', params: [idParam('key', 'Category key')], stateChanging: true, requestBody: jsonBody(null) }),
      delete: op({ summary: 'Delete task category', tag: 'Tasks', params: [idParam('key', 'Category key')], stateChanging: true }),
    },
    '/api/v1/tasks/{id}': {
      get: op({ summary: 'Get task', tag: 'Tasks', params: [idParam()] }),
      put: op({ summary: 'Update task', tag: 'Tasks', params: [idParam()], stateChanging: true, requestBody: jsonBody(null) }),
      delete: op({ summary: 'Delete task', tag: 'Tasks', params: [idParam()], stateChanging: true }),
    },
    '/api/v1/tasks/{id}/status': {
      patch: op({ summary: 'Update task status', tag: 'Tasks', params: [idParam()], stateChanging: true, requestBody: jsonBody(null) }),
    },
    '/api/v1/tasks/{id}/documents': {
      get: op({ summary: 'List documents linked to a task', tag: 'Tasks', params: [idParam()], description: 'Returns family documents linked to the task that are visible to the current user.' }),
      put: op({ summary: 'Set documents linked to a task', tag: 'Tasks', params: [idParam()], stateChanging: true, requestBody: jsonBody(null), description: 'Replace-set of document_ids; only documents visible to the user are linked.' }),
    },
  };
}
