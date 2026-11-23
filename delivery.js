export const STATES = ['Andaman & Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu & Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];
export const ADDRESS_DEFAULTS = Object.freeze({country:'India',pin:'625020',city:'Madurai',state:'Tamil Nadu',line1:'',line2:'',landmark:''});
export function addressText(a) {return [a.line1,a.line2,a.landmark,[a.city,a.state,a.pin].filter(Boolean).join(', '),a.country].filter(Boolean).join('\n');}
export function validateAddress(a, orderType) {
  if (!['ONLINE','OFFLINE'].includes(orderType)) throw new Error('Choose Online or Offline order.');
  for (const key of ['country','city','state','pin']) if (!String(a[key] || '').trim()) throw new Error('Country, PIN code, town/city and state are required.');
  if (!STATES.includes(a.state)) throw new Error('Choose a state from the list.');
  if (a.country.trim().toLowerCase()==='india' && !/^[1-9]\d{5}$/.test(a.pin)) throw new Error('Enter a six-digit Indian PIN code.');
  if (!/^\d{1,12}$/.test(a.pin)) throw new Error('Postal code must contain digits only.');
  if (orderType==='ONLINE' && (!a.line1.trim() || !a.line2.trim())) throw new Error('Online orders require both address lines.');
  for (const [key,value] of Object.entries(a)) if (String(value).length>({line1:120,line2:120,landmark:80,country:60,city:60,state:60,pin:12}[key] || 120)) throw new Error('Address field is too long: '+key);
  return {...a};
}
export function validateContact(name,phone) {
  if (!String(name).trim() || String(name).length>100) throw new Error('Full name is required (maximum 100 characters).');
  const digits=String(phone).replace(/\D/g,'');
  if (!/^(?:91)?[6-9]\d{9}$/.test(digits)) throw new Error('Enter a valid Indian mobile number, optionally prefixed with +91.');
  return digits.slice(-10);
}
