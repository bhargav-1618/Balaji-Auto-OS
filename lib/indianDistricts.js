// lib/indianDistricts.js
//
// Defect #53 (rejection round) — the Address hierarchy previously derived District
// (and City/Area) options from what OTHER customers already had on file. That is a
// real, defensible pattern for City/Area (India has no reasonably-sized, reliably
// hand-authorable master list of every town/locality), but it is NOT defensible for
// District: India's ~780 districts are a well-bounded, publicly documented dataset,
// and a fresh installation with zero customers still needs to let a service advisor
// select "Andhra Pradesh" and immediately see its districts. Sourced from Wikipedia's
// per-state district lists (each state has its own "List of districts of <state>"
// article) — real, current district names, not fabricated or India-wide-generic
// placeholders. Keyed by the EXACT state strings in lib/indianStates.js (INDIAN_STATES)
// so a lookup is a direct property access, no fuzzy matching required.
//
// City and Area remain derived from existing customer records (see CustomersModule.jsx)
// — deliberately NOT duplicated here. A reliable, complete master list of every Indian
// city/town/locality is a materially larger and less stable dataset than districts (new
// census towns, colloquial locality names, etc.) and hand-authoring one risks presenting
// invented data as authoritative fact. District was the actual reported blocker
// ("select Andhra Pradesh, District is empty") and is the level where a real static
// dataset is both accurate and maintainable; City/Area keep their onAdd escape hatch and
// grow from real usage instead.
export const INDIAN_DISTRICTS = {
  'Andaman and Nicobar Islands': ['Nicobar', 'North and Middle Andaman', 'South Andaman'],
  'Andhra Pradesh': ['Alluri Sitharama Raju', 'Anakapalli', 'Ananthapuramu', 'Annamayya', 'Bapatla', 'Chittoor', 'Dr. B.R. Ambedkar Konaseema', 'East Godavari', 'Eluru', 'Guntur', 'Kakinada', 'Krishna', 'Kurnool', 'Markapuram', 'Nandyal', 'Nellore', 'NTR', 'Palnadu', 'Parvathipuram Manyam', 'Polavaram', 'Prakasam', 'Srikakulam', 'Sri Sathya Sai', 'Tirupati', 'Visakhapatnam', 'Vizianagaram', 'West Godavari', 'YSR Kadapa'],
  'Arunachal Pradesh': ['Anjaw', 'Bichom', 'Changlang', 'East Kameng', 'East Siang', 'Kamle', 'Keyi Panyor', 'Kra Daadi', 'Kurung Kumey', 'Lepa Rada', 'Lohit', 'Longding', 'Lower Dibang Valley', 'Lower Siang', 'Lower Subansiri', 'Namsai', 'Pakke-Kessang', 'Papum Pare', 'Shi Yomi', 'Siang', 'Tawang', 'Tirap', 'Upper Dibang Valley', 'Upper Siang', 'Upper Subansiri', 'West Kameng', 'West Siang'],
  Assam: ['Baksa', 'Bajali', 'Barpeta', 'Biswanath', 'Bongaigaon', 'Cachar', 'Charaideo', 'Chirang', 'Darrang', 'Dhemaji', 'Dhubri', 'Dibrugarh', 'Dima Hasao', 'Goalpara', 'Golaghat', 'Hailakandi', 'Hojai', 'Jorhat', 'Kamrup', 'Kamrup Metropolitan', 'Karbi Anglong', 'Karimganj', 'Kokrajhar', 'Lakhimpur', 'Majuli', 'Morigaon', 'Nagaon', 'Nalbari', 'Sivasagar', 'Sonitpur', 'South Salmara-Mankachar', 'Tamulpur', 'Tinsukia', 'Udalguri', 'West Karbi Anglong'],
  Bihar: ['Araria', 'Arwal', 'Aurangabad', 'Banka', 'Begusarai', 'Bhagalpur', 'Bhojpur', 'Buxar', 'Darbhanga', 'East Champaran', 'Gaya', 'Gopalganj', 'Jamui', 'Jehanabad', 'Kaimur', 'Katihar', 'Khagaria', 'Kishanganj', 'Lakhisarai', 'Madhepura', 'Madhubani', 'Munger', 'Muzaffarpur', 'Nalanda', 'Nawada', 'Patna', 'Purnia', 'Rohtas', 'Saharsa', 'Samastipur', 'Saran', 'Sheikhpura', 'Sheohar', 'Sitamarhi', 'Siwan', 'Supaul', 'Vaishali', 'West Champaran'],
  Chandigarh: ['Chandigarh'],
  Chhattisgarh: ['Balod', 'Baloda Bazar-Bhatapara', 'Balrampur', 'Bastar', 'Bemetara', 'Bijapur', 'Bilaspur', 'Dantewada', 'Dhamtari', 'Durg', 'Gariaband', 'Gaurella-Pendra-Marwahi', 'Janjgir-Champa', 'Jashpur', 'Kabirdham', 'Kanker', 'Khairagarh-Chhuikhadan-Gandai', 'Kondagaon', 'Korba', 'Koriya', 'Mahasamund', 'Manendragarh-Chirmiri-Bharatpur', 'Mohla-Manpur-Ambagarh Chowki', 'Mungeli', 'Narayanpur', 'Raigarh', 'Raipur', 'Rajnandgaon', 'Sakti', 'Sarangarh-Bilaigarh', 'Sukma', 'Surajpur', 'Surguja'],
  'Dadra and Nagar Haveli and Daman and Diu': ['Dadra and Nagar Haveli', 'Daman', 'Diu'],
  Delhi: ['Central Delhi', 'Central North Delhi', 'East Delhi', 'New Delhi', 'North Delhi', 'North East Delhi', 'North West Delhi', 'Old Delhi', 'Outer North Delhi', 'South Delhi', 'South East Delhi', 'South West Delhi', 'West Delhi'],
  Goa: ['North Goa', 'South Goa'],
  Gujarat: ['Ahmedabad', 'Amreli', 'Anand', 'Aravalli', 'Banaskantha', 'Bharuch', 'Bhavnagar', 'Botad', 'Chhota Udaipur', 'Dahod', 'Dang', 'Devbhoomi Dwarka', 'Gandhinagar', 'Gir Somnath', 'Jamnagar', 'Junagadh', 'Kheda', 'Kutch', 'Mahisagar', 'Mehsana', 'Morbi', 'Narmada', 'Navsari', 'Panchmahal', 'Patan', 'Porbandar', 'Rajkot', 'Sabarkantha', 'Surat', 'Surendranagar', 'Tapi', 'Vadodara', 'Valsad', 'Vav-Tharad'],
  Haryana: ['Ambala', 'Bhiwani', 'Charkhi Dadri', 'Faridabad', 'Fatehabad', 'Gurugram', 'Hansi', 'Hisar', 'Jhajjar', 'Jind', 'Kaithal', 'Karnal', 'Kurukshetra', 'Mahendragarh', 'Nuh', 'Palwal', 'Panchkula', 'Panipat', 'Rewari', 'Rohtak', 'Sirsa', 'Sonipat', 'Yamunanagar'],
  'Himachal Pradesh': ['Bilaspur', 'Chamba', 'Hamirpur', 'Kangra', 'Kinnaur', 'Kullu', 'Lahaul and Spiti', 'Mandi', 'Shimla', 'Sirmaur', 'Solan', 'Una'],
  'Jammu and Kashmir': ['Anantnag', 'Bandipora', 'Baramulla', 'Budgam', 'Doda', 'Ganderbal', 'Jammu', 'Kathua', 'Kishtwar', 'Kulgam', 'Kupwara', 'Poonch', 'Pulwama', 'Rajouri', 'Ramban', 'Reasi', 'Samba', 'Shopian', 'Srinagar', 'Udhampur'],
  Jharkhand: ['Bokaro', 'Chatra', 'Deoghar', 'Dhanbad', 'Dumka', 'East Singhbhum', 'Garhwa', 'Giridih', 'Godda', 'Gumla', 'Hazaribagh', 'Jamtara', 'Khunti', 'Koderma', 'Latehar', 'Lohardaga', 'Pakur', 'Palamu', 'Ramgarh', 'Ranchi', 'Sahebganj', 'Saraikela-Kharsawan', 'Simdega', 'West Singhbhum'],
  Karnataka: ['Bagalkote', 'Ballari', 'Belagavi', 'Bengaluru North', 'Bengaluru South', 'Bengaluru Urban', 'Bidar', 'Bijapur', 'Chamarajanagara', 'Chikkaballapura', 'Chikmagalur', 'Chitradurga', 'Dakshina Kannada', 'Davanagere', 'Dharwad', 'Gadag', 'Hassan', 'Haveri', 'Kalaburagi', 'Kodagu', 'Kolar', 'Koppal', 'Mandya', 'Mysuru', 'Raichur', 'Shivamogga', 'Tumakuru', 'Udupi', 'Uttara Kannada', 'Vijayanagara', 'Yadgiri'],
  Kerala: ['Alappuzha', 'Ernakulam', 'Idukki', 'Kannur', 'Kasaragod', 'Kollam', 'Kottayam', 'Kozhikode', 'Malappuram', 'Palakkad', 'Pathanamthitta', 'Thiruvananthapuram', 'Thrissur', 'Wayanad'],
  Ladakh: ['Changthang', 'Drass', 'Kargil', 'Leh', 'Nubra', 'Sham', 'Zanskar'],
  Lakshadweep: ['Lakshadweep'],
  'Madhya Pradesh': ['Agar Malwa', 'Alirajpur', 'Anuppur', 'Ashoknagar', 'Balaghat', 'Barwani', 'Betul', 'Bhind', 'Bhopal', 'Burhanpur', 'Chhatarpur', 'Chhindwara', 'Damoh', 'Datia', 'Dewas', 'Dhar', 'Dindori', 'Guna', 'Gwalior', 'Harda', 'Indore', 'Jabalpur', 'Jhabua', 'Katni', 'Khandwa', 'Khargone', 'Mandla', 'Mandsaur', 'Maihar', 'Mauganj', 'Morena', 'Narmadapuram', 'Narsinghpur', 'Neemuch', 'Niwari', 'Panna', 'Pandhurna', 'Raisen', 'Rajgarh', 'Ratlam', 'Rewa', 'Sagar', 'Satna', 'Sehore', 'Seoni', 'Shahdol', 'Shajapur', 'Sheopur', 'Shivpuri', 'Sidhi', 'Singrauli', 'Tikamgarh', 'Ujjain', 'Umaria', 'Vidisha'],
  Maharashtra: ['Ahmednagar', 'Akola', 'Amravati', 'Aurangabad', 'Beed', 'Bhandara', 'Buldhana', 'Chandrapur', 'Dhule', 'Gadchiroli', 'Gondia', 'Hingoli', 'Jalgaon', 'Jalna', 'Kolhapur', 'Latur', 'Mumbai City', 'Mumbai Suburban', 'Nagpur', 'Nanded', 'Nandurbar', 'Nashik', 'Osmanabad', 'Palghar', 'Parbhani', 'Pune', 'Raigad', 'Ratnagiri', 'Sangli', 'Satara', 'Sindhudurg', 'Solapur', 'Thane', 'Wardha', 'Washim', 'Yavatmal'],
  Manipur: ['Bishnupur', 'Chandel', 'Churachandpur', 'Imphal East', 'Imphal West', 'Jiribam', 'Kakching', 'Kamjong', 'Kangpokpi', 'Noney', 'Pherzawl', 'Senapati', 'Tamenglong', 'Tengnoupal', 'Thoubal', 'Ukhrul'],
  Meghalaya: ['East Garo Hills', 'East Jaintia Hills', 'East Khasi Hills', 'Eastern West Khasi Hills', 'North Garo Hills', 'Ri-Bhoi', 'South Garo Hills', 'South West Garo Hills', 'South West Khasi Hills', 'West Garo Hills', 'West Jaintia Hills', 'West Khasi Hills'],
  Mizoram: ['Aizawl', 'Champhai', 'Hnahthial', 'Khawzawl', 'Kolasib', 'Lawngtlai', 'Lunglei', 'Mamit', 'Saiha', 'Saitual', 'Serchhip'],
  Nagaland: ['Chümoukedima', 'Dimapur', 'Kiphire', 'Kohima', 'Longleng', 'Meluri', 'Mokokchung', 'Mon', 'Niuland', 'Noklak', 'Peren', 'Phek', 'Shamator', 'Tseminyü', 'Tuensang', 'Wokha', 'Zünheboto'],
  Odisha: ['Angul', 'Balangir', 'Balasore', 'Bargarh', 'Bhadrak', 'Boudh', 'Cuttack', 'Debagarh', 'Dhenkanal', 'Gajapati', 'Ganjam', 'Jagatsinghpur', 'Jajpur', 'Jharsuguda', 'Kalahandi', 'Kandhamal', 'Kendrapara', 'Kendujhar', 'Khordha', 'Koraput', 'Malkangiri', 'Mayurbhanj', 'Nabarangpur', 'Nayagarh', 'Nuapada', 'Puri', 'Rayagada', 'Sambalpur', 'Subarnapur', 'Sundargarh'],
  Puducherry: ['Karaikal', 'Mahe', 'Puducherry', 'Yanam'],
  Punjab: ['Amritsar', 'Barnala', 'Bathinda', 'Faridkot', 'Fatehgarh Sahib', 'Fazilka', 'Firozpur', 'Gurdaspur', 'Hoshiarpur', 'Jalandhar', 'Kapurthala', 'Ludhiana', 'Malerkotla', 'Mansa', 'Moga', 'Pathankot', 'Patiala', 'Rupnagar', 'Sahibzada Ajit Singh Nagar', 'Sangrur', 'Shaheed Bhagat Singh Nagar', 'Sri Muktsar Sahib', 'Tarn Taran'],
  Rajasthan: ['Ajmer', 'Alwar', 'Balotra', 'Banswara', 'Baran', 'Barmer', 'Beawar', 'Bharatpur', 'Bhilwara', 'Bikaner', 'Bundi', 'Chittorgarh', 'Churu', 'Dausa', 'Deeg', 'Didwana-Kuchaman', 'Dholpur', 'Dungarpur', 'Hanumangarh', 'Jaipur', 'Jaisalmer', 'Jalore', 'Jhalawar', 'Jhunjhunu', 'Jodhpur', 'Karauli', 'Khairthal-Tijara', 'Kota', 'Kotputli-Behror', 'Nagaur', 'Pali', 'Phalodi', 'Pratapgarh', 'Rajsamand', 'Salumbar', 'Sawai Madhopur', 'Sikar', 'Sirohi', 'Sri Ganganagar', 'Tonk', 'Udaipur'],
  Sikkim: ['Gangtok', 'Gyalshing', 'Mangan', 'Namchi', 'Pakyong', 'Soreng'],
  // Thiruvallur added — missing from the original fetch despite being a real,
  // well-established district (split from Chennai/Kancheepuram in 1997); caught
  // during cross-referencing for this round's City master data.
  'Tamil Nadu': ['Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dharmapuri', 'Dindigul', 'Erode', 'Kallakurichi', 'Kancheepuram', 'Kanyakumari', 'Karur', 'Krishnagiri', 'Madurai', 'Mayiladuthurai', 'Nagapattinam', 'Namakkal', 'Perambalur', 'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga', 'Tenkasi', 'Thanjavur', 'The Nilgiris', 'Theni', 'Thiruvallur', 'Thoothukudi', 'Tiruchirappalli', 'Tirunelveli', 'Tirupattur', 'Tiruppur', 'Tiruvannamalai', 'Tiruvarur', 'Vellore', 'Viluppuram', 'Virudhunagar'],
  Telangana: ['Adilabad', 'Bhadradri Kothagudem', 'Hanumakonda', 'Hyderabad', 'Jagtial', 'Jangaon', 'Jayashankar Bhupalpally', 'Jogulamba Gadwal', 'Kamareddy', 'Karimnagar', 'Khammam', 'Kumuram Bheem Asifabad', 'Mahabubabad', 'Mahabubnagar', 'Mancherial', 'Medak', 'Medchal–Malkajgiri', 'Mulugu', 'Nagarkurnool', 'Nalgonda', 'Narayanpet', 'Nirmal', 'Nizamabad', 'Peddapalli', 'Rajanna Sircilla', 'Ranga Reddy', 'Sangareddy', 'Siddipet', 'Suryapet', 'Vikarabad', 'Wanaparthy', 'Warangal', 'Yadadri Bhuvanagiri'],
  Tripura: ['Dhalai', 'Gomati', 'Khowai', 'North Tripura', 'Sipahijala', 'South Tripura', 'Unakoti', 'West Tripura'],
  'Uttar Pradesh': ['Agra', 'Aligarh', 'Ambedkar Nagar', 'Amethi', 'Amroha', 'Auraiya', 'Ayodhya', 'Azamgarh', 'Bagpat', 'Bahraich', 'Ballia', 'Balrampur', 'Banda', 'Barabanki', 'Bareilly', 'Basti', 'Bhadohi', 'Bijnor', 'Budaun', 'Bulandshahr', 'Chandauli', 'Chitrakoot', 'Deoria', 'Etah', 'Etawah', 'Farrukhabad', 'Fatehpur', 'Firozabad', 'Gautam Buddha Nagar', 'Ghaziabad', 'Ghazipur', 'Gonda', 'Gorakhpur', 'Hamirpur', 'Hapur', 'Hardoi', 'Hathras', 'Jalaun', 'Jaunpur', 'Jhansi', 'Kannauj', 'Kanpur Dehat', 'Kanpur Nagar', 'Kasganj', 'Kaushambi', 'Kushinagar', 'Lakhimpur Kheri', 'Lalitpur', 'Lucknow', 'Maharajganj', 'Mahoba', 'Mainpuri', 'Mathura', 'Mau', 'Meerut', 'Mirzapur', 'Moradabad', 'Muzaffarnagar', 'Pilibhit', 'Pratapgarh', 'Prayagraj', 'Rae Bareli', 'Rampur', 'Saharanpur', 'Sambhal', 'Sant Kabir Nagar', 'Shahjahanpur', 'Shamli', 'Shravasti', 'Siddharthnagar', 'Sitapur', 'Sonbhadra', 'Sultanpur', 'Unnao', 'Varanasi'],
  Uttarakhand: ['Almora', 'Bageshwar', 'Chamoli', 'Champawat', 'Dehradun', 'Haridwar', 'Nainital', 'Pauri Garhwal', 'Pithoragarh', 'Rudraprayag', 'Tehri Garhwal', 'Udham Singh Nagar', 'Uttarkashi'],
  'West Bengal': ['Alipurduar', 'Arambagh', 'Bankura', 'Basirhat', 'Birbhum', 'Cooch Behar', 'Dakshin Dinajpur', 'Darjeeling', 'Hooghly', 'Howrah', 'Jalpaiguri', 'Jangipur', 'Jhargram', 'Kalimpong', 'Kolkata', 'Malda', 'Murshidabad', 'Nadia', 'North 24 Parganas', 'Paschim Bardhaman', 'Paschim Medinipur', 'Purba Bardhaman', 'Purba Medinipur', 'Purulia', 'South 24 Parganas', 'Sundarbans', 'Uttar Dinajpur'],
};

// Defect #56 (reopened) — District alone wasn't enough: "select Andhra Pradesh ->
// Visakhapatnam district, City still shows No options" is the same class of problem
// one level down. A reliable, complete master list of every Indian city/town (India
// has thousands of statutory towns) is not something that can be hand-sourced and
// verified accurately within this pass the way the ~780 districts above could —
// presenting an invented or unverifiably-incomplete "complete" city list AS complete
// master data would be worse than being explicit about the real trade-off. What IS
// implemented: real, sourced major-city-per-district data (Wikipedia's per-state
// population/city-list articles) for the six states named in this defect's own
// validation list (Andhra Pradesh, Telangana, Bihar, Karnataka, Tamil Nadu,
// Maharashtra) — covering the workshop's actual highest-volume customer geographies,
// not a token AP-only fix. CustomersModule.jsx tries THIS static data first for any
// state|district; if that combination has no entry here (either because the state
// isn't one of the six, or because a smaller district within it wasn't covered),
// it falls back to the existing derived-from-customer-records City list — so no
// state is ever worse off than before, and the covered majority no longer needs any
// prior customer on file. See "Future Recommendations" in the batch report for the
// production-correct long-term path (a licensed/maintained PIN-code or geo dataset)
// this is deliberately NOT attempting to replace with hand-authored data.
export const CITY_MASTER_DATA = {
  'Andhra Pradesh': {
    Visakhapatnam: ['Visakhapatnam'],
    NTR: ['Vijayawada'],
    Guntur: ['Guntur'],
    Nellore: ['Nellore'],
    Kurnool: ['Kurnool', 'Adoni'],
    Kakinada: ['Kakinada'],
    'East Godavari': ['Rajamahendravaram'],
    'YSR Kadapa': ['Kadapa', 'Proddatur'],
    Tirupati: ['Tirupati'],
    Ananthapuramu: ['Anantapuramu', 'Guntakal', 'Tadipatri'],
    Prakasam: ['Ongole'],
    Vizianagaram: ['Vizianagaram'],
    Eluru: ['Eluru'],
    Chittoor: ['Chittoor'],
  },
  Telangana: {
    Hyderabad: ['Hyderabad'],
    Warangal: ['Warangal'],
    Hanumakonda: ['Hanumakonda'],
    Nizamabad: ['Nizamabad'],
    Karimnagar: ['Karimnagar'],
    Khammam: ['Khammam'],
    Mancherial: ['Mancherial'],
    Mahabubnagar: ['Mahabubnagar'],
    Nalgonda: ['Nalgonda'],
    'Bhadradri Kothagudem': ['Kothagudem'],
    Nirmal: ['Nirmal'],
    'Rajanna Sircilla': ['Sircilla'],
    Kamareddy: ['Kamareddy'],
    Sangareddy: ['Sangareddy', 'Zaheerabad'],
  },
  Bihar: {
    Patna: ['Patna'],
    Gaya: ['Gaya'],
    Bhagalpur: ['Bhagalpur'],
    Muzaffarpur: ['Muzaffarpur'],
    Nalanda: ['Bihar Sharif'],
    Darbhanga: ['Darbhanga'],
    Purnia: ['Purnia'],
    Bhojpur: ['Arrah'],
    Samastipur: ['Samastipur'],
    Begusarai: ['Begusarai'],
  },
  Karnataka: {
    'Bengaluru Urban': ['Bengaluru'],
    Dharwad: ['Hubli-Dharwad'],
    Mysuru: ['Mysore'],
    Belagavi: ['Belagavi'],
    'Dakshina Kannada': ['Mangaluru'],
    Kalaburagi: ['Kalaburagi'],
    Davanagere: ['Davanagere'],
    Ballari: ['Ballari'],
    Bijapur: ['Vijayapura'],
    Shivamogga: ['Shivamogga'],
  },
  'Tamil Nadu': {
    Chennai: ['Chennai', 'Ambattur', 'Tiruvottiyur', 'Alandur', 'Madavaram'],
    Coimbatore: ['Coimbatore', 'Kurichi'],
    Madurai: ['Madurai'],
    Tiruchirappalli: ['Tiruchirappalli'],
    Salem: ['Salem'],
    Tirunelveli: ['Tirunelveli'],
    Tiruppur: ['Tiruppur'],
    Thiruvallur: ['Avadi'],
    Thoothukudi: ['Thoothukkudi'],
  },
  Maharashtra: {
    'Mumbai City': ['Mumbai'],
    'Mumbai Suburban': ['Mumbai'],
    Pune: ['Pune', 'Pimpri-Chinchwad'],
    Nagpur: ['Nagpur'],
    Thane: ['Thane', 'Kalyan-Dombivli', 'Mira-Bhayandar', 'Ulhasnagar', 'Ambarnath', 'Badlapur'],
    Nashik: ['Nashik', 'Malegaon'],
    Aurangabad: ['Aurangabad'],
    Solapur: ['Solapur'],
    Kolhapur: ['Kolhapur'],
    Jalgaon: ['Jalgaon'],
  },
};
