/**
 * Manual mock for axios
 * This allows Jest to work with axios ES modules
 */

// Create mock functions that can be shared and mocked
const mockGet = jest.fn(() => Promise.resolve({ data: {} }));
const mockPost = jest.fn(() => Promise.resolve({ data: {} }));
const mockPut = jest.fn(() => Promise.resolve({ data: {} }));
const mockPatch = jest.fn(() => Promise.resolve({ data: {} }));
const mockDelete = jest.fn(() => Promise.resolve({ data: {} }));
const mockCreate = jest.fn(() => {
  // Return an instance that uses the same mock functions
  return {
    get: mockGet,
    post: mockPost,
    put: mockPut,
    patch: mockPatch,
    delete: mockDelete,
    create: mockCreate,
    defaults: {
      headers: {
        common: {},
      },
    },
    interceptors: {
      request: {
        use: jest.fn(),
        eject: jest.fn(),
      },
      response: {
        use: jest.fn(),
        eject: jest.fn(),
      },
    },
  };
});

const axios = {
  get: mockGet,
  post: mockPost,
  put: mockPut,
  patch: mockPatch,
  delete: mockDelete,
  create: mockCreate,
  defaults: {
    headers: {
      common: {},
    },
  },
  interceptors: {
    request: {
      use: jest.fn(),
      eject: jest.fn(),
    },
    response: {
      use: jest.fn(),
      eject: jest.fn(),
    },
  },
};

module.exports = axios;
module.exports.default = axios;
