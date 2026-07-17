"""
ML Service Configuration — Universal All-India Edition
Supports Tamil Nadu, Karnataka, Maharashtra, UP, Delhi, AP, Telangana, Punjab, Kerala, and more.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "saved_models"
for d in [DATA_DIR, MODEL_DIR]:
    d.mkdir(parents=True, exist_ok=True)

FIR_DATASET_PATH = os.getenv("FIR_DATASET_PATH", r"c:\Users\gowth\Desktop\Mohammad_CLG\Final\Final\TamilNadu_FIR_Dataset_1Lakh_Claude.csv")

# ── Geocoding Fallbacks (For 0.0, 0.0 coordinates) ──
# Covers all major districts across India for universal state support
DISTRICT_COORDS = {
    # ── Tamil Nadu ──
    "Chennai": (13.0827, 80.2707), "Coimbatore": (11.0168, 76.9558),
    "Madurai": (9.9252, 78.1198), "Tiruchirappalli": (10.7905, 78.7047),
    "Salem": (11.6643, 78.1460), "Erode": (11.3410, 77.7172),
    "Vellore": (12.9165, 79.1325), "Tirunelveli": (8.7139, 77.7567),
    "Chengalpattu": (12.6939, 79.9757), "Dharmapuri": (12.1211, 78.1582),
    "Thiruvallur": (13.1231, 79.9066), "Ranipet": (12.9275, 79.3322),
    "Tirupathur": (12.4961, 78.5671), "Kallakurichi": (11.7380, 78.9610),
    "Villupuram": (11.9401, 79.4861), "Cuddalore": (11.7480, 79.7714),
    "Nagapattinam": (10.7672, 79.8420), "Thanjavur": (10.7870, 79.1378),
    "Tiruvarur": (10.7730, 79.6363), "Pudukkottai": (10.3833, 78.8001),
    "Dindigul": (10.3673, 77.9803), "Krishnagiri": (12.5266, 78.2137),
    "Namakkal": (11.2189, 78.1674), "Karur": (10.9601, 78.0766),
    "Perambalur": (11.2333, 78.8800), "Ariyalur": (11.1400, 79.0764),
    "Tenkasi": (8.9577, 77.3152), "Theni": (10.0104, 77.4770),
    "Sivaganga": (9.8479, 78.4821), "Ramanathapuram": (9.3607, 78.8306),
    "Thoothukudi": (8.7642, 78.1348), "Kanyakumari": (8.0883, 77.5385),
    # ── Karnataka ──
    "Bengaluru City": (12.9716, 77.5946), "Bengaluru": (12.9716, 77.5946),
    "Mysuru City": (12.2958, 76.6394), "Mysuru": (12.2958, 76.6394),
    "Hubballi Dharwad City": (15.3647, 75.1240), "Mangaluru City": (12.9141, 74.8560),
    "Belagavi City": (15.8497, 74.4977), "Bagalkot": (16.1817, 75.6958),
    "Ballari": (15.1394, 76.9214), "Bidar": (17.9104, 77.5199),
    "Chamarajanagar": (11.9261, 76.9406), "Chikkaballapura": (13.4325, 77.7275),
    "Chikkamagaluru": (13.3161, 75.7720), "Chitradurga": (14.2255, 76.3980),
    "Dakshina Kannada": (12.8698, 75.2505), "Davanagere": (14.4644, 75.9218),
    "Gadag": (15.4300, 75.6333), "Hassan": (13.0033, 76.1004),
    "Haveri": (14.7951, 75.4013), "Kalaburagi": (17.3297, 76.8343),
    "Kodagu": (12.3375, 75.8069), "Kolar": (13.1367, 78.1291),
    "Koppal": (15.3472, 76.1554), "Mandya": (12.5218, 76.8951),
    "Raichur": (16.2076, 77.3463), "Ramanagara": (12.7209, 77.2816),
    "Shivamogga": (13.9299, 75.5681), "Tumakuru": (13.3392, 77.1016),
    "Udupi": (13.3409, 74.7421), "Uttara Kannada": (14.7214, 74.6545),
    "Vijayapura": (16.8302, 75.7100), "Yadgir": (16.7644, 77.1408),
    # ── Maharashtra ──
    "Mumbai": (19.0760, 72.8777), "Pune": (18.5204, 73.8567),
    "Nagpur": (21.1458, 79.0882), "Nashik": (19.9975, 73.7898),
    "Aurangabad": (19.8762, 75.3433), "Solapur": (17.6805, 75.9064),
    "Amravati": (20.9320, 77.7523), "Kolhapur": (16.7050, 74.2433),
    "Latur": (18.4088, 76.5604), "Nanded": (19.1383, 77.3210),
    "Thane": (19.2183, 72.9781), "Raigad": (18.5158, 73.1819),
    "Osmanabad": (18.1861, 76.0387), "Jalgaon": (21.0077, 75.5626),
    "Navi Mumbai": (19.0330, 73.0297), "Kalyan": (19.2402, 73.1305),
    # ── Andhra Pradesh ──
    "Visakhapatnam": (17.6868, 83.2185), "Vijayawada": (16.5062, 80.6480),
    "Guntur": (16.3067, 80.4365), "Nellore": (14.4426, 79.9865),
    "Kurnool": (15.8281, 78.0373), "Tirupati": (13.6288, 79.4192),
    "Kadapa": (14.4753, 78.8233), "Rajahmundry": (17.0005, 81.8040),
    "Kakinada": (16.9891, 82.2475), "Anantapur": (14.6819, 77.6006),
    # ── Telangana ──
    "Hyderabad": (17.3850, 78.4867), "Warangal": (17.9784, 79.5941),
    "Nizamabad": (18.6726, 78.0940), "Karimnagar": (18.4386, 79.1288),
    "Khammam": (17.2473, 80.1514), "Rangareddy": (17.3650, 78.4250),
    "Medchal": (17.6285, 78.5356), "Nalgonda": (17.0575, 79.2678),
    "Medak": (18.0500, 78.2667), "Siddipet": (18.1018, 78.8521),
    # ── Rajasthan ──
    "Jaipur": (26.9124, 75.7873), "Jodhpur": (26.2389, 73.0243),
    "Udaipur": (24.5854, 73.7125), "Kota": (25.2138, 75.8648),
    "Ajmer": (26.4524, 74.6382), "Bikaner": (28.0229, 73.3119),
    "Alwar": (27.5530, 76.6346), "Bharatpur": (27.2152, 77.4839),
    # ── Uttar Pradesh ──
    "Lucknow": (26.8467, 80.9462), "Agra": (27.1767, 78.0081),
    "Varanasi": (25.3176, 82.9739), "Prayagraj": (25.4358, 81.8463),
    "Allahabad": (25.4358, 81.8463), "Kanpur": (26.4499, 80.3319),
    "Ghaziabad": (28.6692, 77.4538), "Noida": (28.5355, 77.3910),
    "Meerut": (28.9845, 77.7064), "Mathura": (27.4924, 77.6737),
    "Bareilly": (28.3670, 79.4304), "Aligarh": (27.8974, 78.0880),
    "Moradabad": (28.8386, 78.7733), "Gorakhpur": (26.7606, 83.3732),
    # ── Madhya Pradesh ──
    "Bhopal": (23.2599, 77.4126), "Indore": (22.7196, 75.8577),
    "Gwalior": (26.2183, 78.1828), "Jabalpur": (23.1815, 79.9864),
    "Ujjain": (23.1765, 75.7885), "Sagar": (23.8388, 78.7378),
    "Raipur": (21.2514, 81.6296),
    # ── Gujarat ──
    "Ahmedabad": (23.0225, 72.5714), "Surat": (21.1702, 72.8311),
    "Vadodara": (22.3072, 73.1812), "Rajkot": (22.3039, 70.8022),
    "Gandhinagar": (23.2156, 72.6369), "Bhavnagar": (21.7645, 72.1519),
    # ── Delhi & NCR ──
    "Central Delhi": (28.6448, 77.2167), "North Delhi": (28.7041, 77.1025),
    "South Delhi": (28.5244, 77.1855), "East Delhi": (28.6671, 77.3008),
    "West Delhi": (28.6333, 77.0833), "New Delhi": (28.6139, 77.2090),
    "Delhi": (28.6139, 77.2090), "Gurugram": (28.4595, 77.0266),
    "Faridabad": (28.4082, 77.3178), "Noida": (28.5355, 77.3910),
    # ── Punjab ──
    "Amritsar": (31.6340, 74.8723), "Ludhiana": (30.9010, 75.8573),
    "Jalandhar": (31.3260, 75.5762), "Patiala": (30.3398, 76.3869),
    "Chandigarh": (30.7333, 76.7794), "Bathinda": (30.2110, 74.9455),
    # ── Haryana ──
    "Panipat": (29.3909, 76.9635), "Rohtak": (28.8955, 76.6066),
    "Hisar": (29.1492, 75.7217), "Ambala": (30.3782, 76.7767),
    # ── West Bengal ──
    "Kolkata": (22.5726, 88.3639), "Howrah": (22.5958, 88.2636),
    "Asansol": (23.6739, 86.9524), "Siliguri": (26.7271, 88.3953),
    "Durgapur": (23.5204, 87.3119), "Bardhaman": (23.2324, 87.8615),
    # ── Bihar ──
    "Patna": (25.5941, 85.1376), "Gaya": (24.7955, 85.0002),
    "Bhagalpur": (25.2425, 86.9842), "Muzaffarpur": (26.1197, 85.3910),
    # ── Odisha ──
    "Bhubaneswar": (20.2961, 85.8245), "Cuttack": (20.4625, 85.8830),
    "Rourkela": (22.2604, 84.8536), "Brahmapur": (19.3150, 84.7941),
    # ── Kerala ──
    "Thiruvananthapuram": (8.5241, 76.9366), "Kochi": (9.9312, 76.2673),
    "Kozhikode": (11.2588, 75.7804), "Thrissur": (10.5276, 76.2144),
    "Kollam": (8.8932, 76.6141), "Kannur": (11.8745, 75.3704),
    # ── North East ──
    "Guwahati": (26.1445, 91.7362), "Imphal": (24.8170, 93.9368),
    "Agartala": (23.8315, 91.2868), "Shillong": (25.5788, 91.8933),
}

# ── District-to-State lookup for geocoding context queries ──
TAMIL_NADU_DISTRICTS = {
    "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Erode",
    "Vellore", "Tirunelveli", "Chengalpattu", "Dharmapuri", "Thiruvallur",
    "Ranipet", "Tirupathur", "Kallakurichi", "Villupuram", "Cuddalore",
    "Nagapattinam", "Thanjavur", "Tiruvarur", "Pudukkottai", "Dindigul",
    "Krishnagiri", "Namakkal", "Karur", "Perambalur", "Ariyalur",
    "Tenkasi", "Theni", "Sivaganga", "Ramanathapuram", "Thoothukudi", "Kanyakumari",
}

KARNATAKA_DISTRICTS = {
    "Bengaluru City", "Bengaluru", "Mysuru City", "Mysuru", "Hubballi Dharwad City",
    "Mangaluru City", "Belagavi City", "Bagalkot", "Ballari", "Bidar",
    "Chamarajanagar", "Chikkaballapura", "Chikkamagaluru", "Chitradurga",
    "Dakshina Kannada", "Davanagere", "Gadag", "Hassan", "Haveri", "Kalaburagi",
    "Kodagu", "Kolar", "Koppal", "Mandya", "Raichur", "Ramanagara",
    "Shivamogga", "Tumakuru", "Udupi", "Uttara Kannada", "Vijayapura", "Yadgir",
}

# Build a state-lookup dict for smart geocoding: {district_name → state}
DISTRICT_TO_STATE: dict = {}
for d in TAMIL_NADU_DISTRICTS:
    DISTRICT_TO_STATE[d] = "Tamil Nadu"
for d in KARNATAKA_DISTRICTS:
    DISTRICT_TO_STATE[d] = "Karnataka"
for d in {"Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Solapur", "Amravati",
           "Kolhapur", "Latur", "Nanded", "Thane", "Raigad", "Osmanabad", "Jalgaon"}:
    DISTRICT_TO_STATE[d] = "Maharashtra"
for d in {"Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Rangareddy", "Medchal", "Nalgonda"}:
    DISTRICT_TO_STATE[d] = "Telangana"
for d in {"Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Tirupati", "Kadapa", "Rajahmundry"}:
    DISTRICT_TO_STATE[d] = "Andhra Pradesh"
for d in {"Lucknow", "Agra", "Varanasi", "Prayagraj", "Kanpur", "Ghaziabad", "Meerut", "Bareilly"}:
    DISTRICT_TO_STATE[d] = "Uttar Pradesh"
for d in {"Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner"}:
    DISTRICT_TO_STATE[d] = "Rajasthan"
for d in {"Delhi", "New Delhi", "Central Delhi", "North Delhi", "South Delhi", "East Delhi", "West Delhi"}:
    DISTRICT_TO_STATE[d] = "Delhi"
for d in {"Amritsar", "Ludhiana", "Jalandhar", "Patiala", "Chandigarh", "Bathinda"}:
    DISTRICT_TO_STATE[d] = "Punjab"
for d in {"Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar"}:
    DISTRICT_TO_STATE[d] = "Gujarat"
for d in {"Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Kannur"}:
    DISTRICT_TO_STATE[d] = "Kerala"
for d in {"Kolkata", "Howrah", "Asansol", "Siliguri", "Durgapur"}:
    DISTRICT_TO_STATE[d] = "West Bengal"
for d in {"Patna", "Gaya", "Bhagalpur", "Muzaffarpur"}:
    DISTRICT_TO_STATE[d] = "Bihar"
for d in {"Bhubaneswar", "Cuttack", "Rourkela"}:
    DISTRICT_TO_STATE[d] = "Odisha"

# Keep backward compat alias
KARNATAKA_DISTRICT_COORDS = DISTRICT_COORDS

# ── Universal Column Alias Map ──
# Maps our standard internal column names → all known alternate headers used by different state portals
COLUMN_ALIASES = {
    "FIR_ID":              ["FIR_ID", "FIR No", "FIRNo", "CaseNo", "case_no", "fir_number", "id", "FirNo", "FIR_Number"],
    "Latitude":            ["Latitude", "lat", "LAT", "latitude", "Lat", "GPS_Lat", "Y", "y"],
    "Longitude":           ["Longitude", "lon", "LON", "longitude", "Lng", "lng", "Long", "GPS_Long", "X", "x"],
    "District_Name":       ["District_Name", "District", "Dist", "DISTRICT", "district", "dist_name", "DistrictName", "District Name"],
    "UnitName":            ["UnitName", "Unit_Name", "PS_Name", "police_station", "Station", "PS", "UnitID", "Police_Station"],
    "Offence_From_Date":   ["Offence_From_Date", "From_Date", "Crime_Date", "IncidentDate", "DateOfOffence", "offense_date", "crime_date", "Date", "OffenseDate", "Incident_Date"],
    "Offence_To_Date":     ["Offence_To_Date", "To_Date"],
    "FIR_Reg_DateTime":    ["FIR_Reg_DateTime", "Registration_Date", "RegDate", "FIR_Reg_Date"],
    "FIR_Date":            ["FIR_Date", "Date_of_FIR"],
    "Year":                ["Year", "year", "YEAR", "yr"],
    "Month":               ["Month", "month", "MONTH", "mo"],
    "CrimeGroup_Name":     ["CrimeGroup_Name", "Crime_Group", "CrimeCategory", "OffenceType", "crime_type", "CrimeType",
                            "crime_category", "CrimeHead", "offense_type", "Crime_Category", "CrimeGroup", "crime_group",
                            "CrimeClassification", "Crime Type", "Offence_Type", "OffenceCategory"],
    "CrimeHead_Name":      ["CrimeHead_Name", "Crime_Head", "OffenceHead", "offence_head", "CrimeHead"],
    "FIR_Type":            ["FIR_Type", "FIR Type", "fir_type", "CaseType", "FirType"],
    "FIR_Stage":           ["FIR_Stage", "Stage"],
    "ActSection":          ["ActSection", "Act_Section", "Section", "IPC_Section", "act_section", "Sections", "Section_No", "IPC"],
    "Place_of_Offence":    ["Place_of_Offence", "Place of Offence", "PlaceOfOffence", "place", "location", "Crime_Location", "Place"],
    "Village_Area_Name":   ["Village_Area_Name", "Village", "Area", "Locality", "locality", "village", "Beat_Area"],
    "Beat_Name":           ["Beat_Name", "Beat", "beat", "BeatNo"],
    "VICTIM_COUNT":        ["VICTIM_COUNT", "Victim_Count", "VictimCount", "victims", "victim_count", "No_of_Victims"],
    "Accused_Count":       ["Accused_Count", "Accused Count", "AccusedCount", "accused", "No_of_Accused"],
    "Arrested_Count":      ["Arrested_Count", "Arrested Count", "ArrestedCount", "arrested", "No_Arrested"],
}

# ── PROBLEM STATEMENT SPECIFIC CLASSIFICATIONS ──
ACT_CLASSIFICATIONS = {
    "IPC_VIOLENT": ["302", "304-B", "307", "322", "324", "351", "354", "509"],
    "IPC_PROPERTY": ["379", "380", "383", "390", "391", "392", "395", "396", "397", "411", "420"],
    "IPC_WOMEN_CHILDREN": ["304-B", "354", "509", "498-A", "363", "364", "365", "366", "376"],
    "IPC_PUBLIC_ORDER": ["121", "141", "144", "146", "147", "148", "151", "153-A", "295-A", "268", "504", "506"],
    "IPC_TRESPASS_FORGERY": ["441", "442", "447", "448", "454", "457", "465", "467", "468", "470", "471", "489-A"],
    "NDPS_ACT": ["20", "21", "22"],
    "GAMBLING_ACT": ["13"],
    "ARMS_ACT": ["25"],
    "EXCISE_ACT": ["60", "60(2)", "72"],
    "COW_PROTECTION": ["3", "5", "11"],
    "SC_ST_ACT": ["3"],
    "MINING_ACT": ["4", "21"],
    "IMMORAL_TRAFFIC": ["3", "4", "5"],
    "GOONDA_ACT": ["3"]
}

# Seasonal Mapping for Behavioural Analysis
SEASONS = {
    12: "Winter", 1: "Winter", 2: "Winter",
    3: "Summer", 4: "Summer", 5: "Summer",
    6: "Monsoon", 7: "Monsoon", 8: "Monsoon", 9: "Monsoon",
    10: "Post-Monsoon", 11: "Post-Monsoon"
}

# ── Universal Crime Severity Mapping ──
# Covers Tamil Nadu, Karnataka, AP, Telangana, Maharashtra, UP, Delhi, Punjab, Kerala
# and all generic IPC/BNS crime group names used by CCTNS portal exports from any state
CRIME_SEVERITY_MAP = {
    # ── Tamil Nadu CrimeGroup_Name ──
    "CRIMES AGAINST BODY": 8, "CRIMES AGAINST WOMEN": 9,
    "CRIMES AGAINST CHILDREN": 9, "CRIMES AGAINST PROPERTY": 6,
    "NDPS / DRUG OFFENCES": 7, "CYBER CRIMES": 5, "ECONOMIC OFFENCES": 5,
    "ARMS ACT VIOLATIONS": 8, "MOTOR VEHICLE OFFENCES": 4,
    "PUBLIC ORDER & OTHER IPC": 6, "CRIMES AGAINST SENIOR CITIZENS": 7,
    "ATROCITY CRIMES": 8, "SC/ST ATROCITIES": 8,
    # ── Karnataka ──
    "MURDER": 10, "RAPE": 10, "POCSO": 9, "DOWRY DEATH": 10,
    "ATTEMPT TO MURDER": 9, "KIDNAPPING": 9, "DACOITY": 8, "ROBBERY": 8,
    "CRIMES RELATED TO WOMEN": 8, "BURGLARY - NIGHT": 7, "CYBER CRIME": 6,
    "THEFT": 4, "KARNATAKA POLICE ACT 1963": 3, "MOTOR VEHICLE ACCIDENTS FATAL": 8,
    "HOUSE BREAKING": 6, "CHEATING": 5, "ASSAULT": 7, "KIDNAPPING OF WOMEN": 9,
    "BURGLARY - DAY": 6, "ROBBERY OF CROPS": 6, "EXTORTION": 8,
    # ── Maharashtra / AP / Telangana generic labels ──
    "OFFENCES AGAINST PERSON": 8, "OFFENCES AGAINST PROPERTY": 6,
    "OFFENCES AGAINST WOMEN": 9, "OFFENCES AGAINST CHILDREN": 9,
    "OFFENCES AGAINST STATE": 7, "DRUG OFFENCES": 7, "CYBER OFFENCES": 5,
    "ECONOMIC OFFENCES / FRAUD": 5, "ARMS & EXPLOSIVES": 8,
    "ROAD ACCIDENTS": 6, "RIOT": 7, "OUTRAGING MODESTY": 8,
    "HURT": 6, "GRIEVOUS HURT": 8, "CULPABLE HOMICIDE": 9,
    "CRIMINAL INTIMIDATION": 6, "WRONGFUL CONFINEMENT": 7,
    # ── Delhi / UP / Punjab generic ──
    "CRIME AGAINST WOMEN": 9, "CRIME AGAINST CHILDREN": 9,
    "CRIME AGAINST PROPERTY": 6, "CRIME AGAINST BODY": 8,
    "CRIME AGAINST SENIOR CITIZENS": 7, "TRAFFIC VIOLATIONS": 3,
    "SNATCHING": 7, "AUTO THEFT": 5, "VEHICLE THEFT": 5,
    "CHAIN SNATCHING": 7, "MOB LYNCHING": 9, "COMMUNAL VIOLENCE": 9,
    # ── BNS 2024 equivalents & special categories ──
    "ORGANISED CRIME": 9, "TERRORISM": 10, "HUMAN TRAFFICKING": 10,
    "MISSING PERSON": 4, "MISSING CHILD": 7, "ACCIDENT FATAL": 7,
    "ACCIDENT NON-FATAL": 4, "FRAUD": 5, "FORGERY": 5, "ARSON": 7,
    # ── Short-form matches (partial) ──
    "MURDER": 10, "KIDNAP": 9, "ABDUCTION": 8,
    "SEXUAL ASSAULT": 10, "MOLESTATION": 8, "STALKING": 6,
    "ACID ATTACK": 10, "HONOR KILLING": 10,
    "ROBBERY": 8, "BURGLARY": 7, "THEFT": 4, "FRAUD": 5,
    "NARCOTIC": 7, "DRUGS": 7, "GAMBLING": 3, "BOOTLEGGING": 4,
}

FIR_TYPE_DEFAULT_SEVERITY = {"Heinous": 8, "Non Heinous": 3, "Other": 5}

# ── DBSCAN Parameters ──
DBSCAN_EPS = 2.0
DBSCAN_MIN_SAMPLES = 5
DBSCAN_METRIC = "haversine"

# ── ARIMA Parameters ──
ARIMA_ORDER = (2, 1, 2)
SARIMA_SEASONAL_ORDER = (1, 1, 1, 7)
PREDICTION_HORIZON_HOURS = 72

# ── Risk Score Weights ──
RISK_WEIGHTS = {
    "crime_frequency": 0.4,
    "severity_score": 0.3,
    "recent_trend": 0.2,
    "time_factor": 0.1,
}

# 1km grid — maximum accuracy (generates ~5000 grid cells)
GRID_SIZE_KM = 1.0

# No cap — train ARIMA on ALL grid areas for maximum accuracy
MAX_ARIMA_AREAS = 99999
