const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const job = await prisma.job.create({
    data: {
      companyId: 'cbacfa6a-3038-4369-b43b-e4450da35bcd', // REPLACE THIS!
      name: 'Main Street Construction',
      address: '123 Main St, Los Angeles, CA',
      geofenceCenter: '34.0522,-118.2437', // LA coordinates
      geofenceRadiusMeters: 100,
      isActive: true,
    },
  });
  
  console.log('✅ Job site created!');
  console.log('Name:', job.name);
  console.log('Address:', job.address);
  console.log('Geofence:', job.geofenceRadiusMeters, 'meters');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error.message);
  })
  .finally(() => prisma.$disconnect());