import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe("Ping", () => {
      it("ping the server health endpoint", async () => {
        const response = await api.get('/health')
        expect(response.status).toEqual(200)
      })
    })

    describe("Detailed health status", () => {
      it("requires admin auth", async () => {
        const response = await api
          .get('/admin/health-status')
          .catch((err: any) => err.response)
        expect(response.status).toEqual(401)
      })
    })
  },
})