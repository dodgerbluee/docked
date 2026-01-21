/**
 * Quick test script for V2 architecture
 * Run with: node test-v2.js
 */

const UpdateComparisonService = require('./services/UpdateComparisonService');
const { getAllPortainerInstances } = require('./db/index');

async function testV2() {
  console.log('🧪 Testing V2 Architecture...\n');
  
  try {
    // Get Portainer instances
    const instances = await getAllPortainerInstances(1);
    console.log(`✅ Found ${instances.length} Portainer instance(s)`);
    
    if (instances.length === 0) {
      console.log('❌ No Portainer instances configured');
      return;
    }
    
    // Test first instance
    const instance = instances[0];
    console.log(`\n📡 Testing instance: ${instance.name} (${instance.url})`);
    
    // Create comparison service
    const service = new UpdateComparisonService();
    
    // Get containers for first endpoint (assuming endpoint 2 or 3)
    const portainerClient = service._getPortainerClient(instance.url, instance.apiKey);
    
    const endpoints = await portainerClient.getEndpoints();
    console.log(`✅ Found ${endpoints.length} endpoint(s)`);
    
    if (endpoints.length === 0) {
      console.log('❌ No endpoints found');
      return;
    }
    
    // Test with first endpoint
    const endpoint = endpoints.find(e => e.Id === 3) || endpoints[0]; // Try endpoint 3 first
    console.log(`\n🐳 Checking containers on endpoint: ${endpoint.Name} (ID: ${endpoint.Id})`);
    
    const containers = await portainerClient.getContainers(endpoint.Id);
    console.log(`✅ Found ${containers.length} container(s)`);
    
    // Test with first few containers
    const containersToTest = containers.slice(0, 5);
    console.log(`\n🔍 Testing ${containersToTest.length} container(s):\n`);
    
    for (const container of containersToTest) {
      const name = (container.Names?.[0] || '').replace(/^\//, '');
      console.log(`\n📦 ${name} (${container.Image})`);
      
      try {
        const result = await service.checkContainerUpdate({
          portainerUrl: instance.url,
          apiKey: instance.apiKey,
          endpointId: endpoint.Id,
          container,
        });
        
        console.log(`   Platform: ${result.platform.os}/${result.platform.architecture}`);
        console.log(`   Running digest: ${result.runningDigest ? result.runningDigest.substring(0, 20) + '...' : 'N/A'}`);
        console.log(`   Registry digest: ${result.registryDigest ? result.registryDigest.substring(0, 20) + '...' : 'N/A'}`);
        console.log(`   Multi-arch: ${result.isManifestList}`);
        console.log(`   Has update: ${result.hasUpdate ? '✅ YES' : '❌ NO'}`);
        
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
    
    console.log('\n\n✅ V2 Architecture Test Complete!');
    console.log('\nKey Observations:');
    console.log('- If postgres:15, postgres:17, redis:6 show "Has update: NO" → ✅ Multi-arch working correctly');
    console.log('- If latest tags show "Has update: YES" → ✅ Real updates detected');
    console.log('- Check that platform is detected for all containers');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  }
  
  process.exit(0);
}

testV2();
