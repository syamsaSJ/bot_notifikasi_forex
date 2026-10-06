import dns from 'dns';

const hosts = [
  'nodedata.forexfactory.com',
  'www.forexfactory.com',
  'raw.githubusercontent.com',
  'api.github.com',
  'google.com',
];

hosts.forEach(host => {
  dns.lookup(host, (err, address, family) => {
    if (err) {
      console.log(`❌ DNS Lookup Failed for ${host}: ${err.message}`);
    } else {
      console.log(`✅ DNS Lookup Passed for ${host}: ${address} (IPv${family})`);
    }
  });
});
