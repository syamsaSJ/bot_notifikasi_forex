import axios from 'axios';

async function testFairEconomy() {
  console.log('Testing FairEconomy Forex Factory JSON Feed...');
  try {
    const res = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      timeout: 10000
    });
    console.log('Status:', res.status, '| Total Events:', res.data.length);
    if (res.data && res.data.length > 0) {
      console.log('Sample item:', res.data[0]);
      const usdEvents = res.data.filter(item => item.country === 'USD' || item.currency === 'USD');
      console.log('Total USD Events this week:', usdEvents.length);
      console.log('Sample USD Event:', usdEvents[0]);
    }
  } catch (err) {
    console.log('Error fetching FairEconomy JSON:', err.message);
  }
}

testFairEconomy();
