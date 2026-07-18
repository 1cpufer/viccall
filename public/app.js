const CARS = [
  {make:"Toyota",model:"Supra",year:1994,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Toyota_Supra_mk4.jpg/1280px-Toyota_Supra_mk4.jpg",hint:"Iconic JDM sports car"},
  {make:"Mazda",model:"RX-7",year:1993,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Mazda_RX-7_FD3S%2C_front_right%2C_05-05-2024.jpg/1280px-Mazda_RX-7_FD3S%2C_front_right%2C_05-05-2024.jpg",hint:"Rotary engine legend"},
  {make:"Nissan",model:"GT-R",year:2009,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/2009_Nissan_GT-R_%28CBA-R35%29_rear.JPG/1280px-2009_Nissan_GT-R_%28CBA-R35%29_rear.JPG",hint:"Godzilla"},
  {make:"Honda",model:"NSX",year:1991,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Honda_E-NA1_NSX_%2822022010324%29.jpg/1280px-Honda_E-NA1_NSX_%2822022010324%29.jpg",hint:"Honda's supercar"},
  {make:"Mitsubishi",model:"Lancer Evolution",year:2003,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/2005_Mitsubishi_Lancer_Evolution_IX_BS_O24.jpg/1280px-2005_Mitsubishi_Lancer_Evolution_IX_BS_O24.jpg",hint:"Rally homologation special"},
  {make:"BMW",model:"M3",year:2000,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/BMW_M3_coupe_E46.jpg/1280px-BMW_M3_coupe_E46.jpg",hint:"E46 era German icon"},
  {make:"Porsche",model:"911",year:1974,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/1988_Porsche_911_Carrera_coupe_%2821477045232%29.jpg/1280px-1988_Porsche_911_Carrera_coupe_%2821477045232%29.jpg",hint:"Air-cooled classic"},
  {make:"Volkswagen",model:"Golf GTI",year:1983,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/c/c5/Volkswagen_Golf_Mk1_GTI_MY_1983.jpg",hint:"Hot hatch pioneer"},
  {make:"Ford",model:"Mustang",year:1969,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Ford_Mustang_Fastback_1969_%2814473569652%29.jpg/1280px-Ford_Mustang_Fastback_1969_%2814473569652%29.jpg",hint:"Classic American muscle"},
  {make:"Chevrolet",model:"Corvette",year:1963,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/1963_Chevrolet_Corvette_Sting_Ray_Sport_Coupe%2C_rear_left%2C_06-24-2024.jpg/1280px-1963_Chevrolet_Corvette_Sting_Ray_Sport_Coupe%2C_rear_left%2C_06-24-2024.jpg",hint:"Split window Sting Ray"},
  {make:"Dodge",model:"Charger",year:1970,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/1970_Dodge_Charger_R-T_Hirschaid_22-20220709-RM-120204.jpg/1280px-1970_Dodge_Charger_R-T_Hirschaid_22-20220709-RM-120204.jpg",hint:"Muscle car era king"},
  {make:"Ferrari",model:"Testarossa",year:1986,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Ferrari_Testarossa_01.jpg/1280px-Ferrari_Testarossa_01.jpg",hint:"80s Italian exotic"},
  {make:"Lamborghini",model:"Countach",year:1978,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Lamborghini_Countach_LP_5000S_1983.jpg/1280px-Lamborghini_Countach_LP_5000S_1983.jpg",hint:"Poster car of a generation"},
  {make:"Peugeot",model:"205 GTI",year:1986,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/1989_Peugeot_205_GTI_1.9_%2816556791566%29.jpg/1280px-1989_Peugeot_205_GTI_1.9_%2816556791566%29.jpg",hint:"French hot hatch"},
  {make:"Renault",model:"Alpine A110",year:1973,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Renault_Alpine_A_110_%28Sp%29.JPG/1280px-Renault_Alpine_A_110_%28Sp%29.JPG",hint:"Rally legend from France"},
  {make:"Aston Martin",model:"DB5",year:1964,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/1964_Aston_Martin_DB5_Vantage_Rev.jpg/1280px-1964_Aston_Martin_DB5_Vantage_Rev.jpg",hint:"Bond's car"},
  {make:"Jaguar",model:"E-Type",year:1961,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Jaguar_E-Type_Series_1_3.8_Litre_1961.jpg/1280px-Jaguar_E-Type_Series_1_3.8_Litre_1961.jpg",hint:"Enzo called it the most beautiful car ever made"},
  {make:"Toyota",model:"AE86 Corolla",year:1985,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/1983_Toyota_Corolla_Levin.jpg/960px-1983_Toyota_Corolla_Levin.jpg",hint:"Drift culture icon from Initial D"},
  {make:"Nissan",model:"Skyline GT-R R34",year:1999,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Nissan_Skyline_GT-R_R34_V_Spec_II.jpg/960px-Nissan_Skyline_GT-R_R34_V_Spec_II.jpg",hint:"Fast and Furious favorite"},
  {make:"Nissan",model:"350Z",year:2003,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/2004_Nissan_350Z_3.5_Front.jpg/960px-2004_Nissan_350Z_3.5_Front.jpg",hint:"Z-car revival"},
  {make:"Honda",model:"S2000",year:1999,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/HondaS2000-004.jpg/960px-HondaS2000-004.jpg",hint:"High-revving roadster"},
  {make:"Honda",model:"Civic Type R",year:1997,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/2024_Honda_Civic_Type_R%2C_front_right%2C_06-15-2024.jpg/960px-2024_Honda_Civic_Type_R%2C_front_right%2C_06-15-2024.jpg",hint:"EK9 hot hatch"},
  {make:"Subaru",model:"Impreza WRX STI",year:1999,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Subaru_Impreza_%28GU%29_Automesse_Ludwigsburg_2024_IMG_1593.jpg/960px-Subaru_Impreza_%28GU%29_Automesse_Ludwigsburg_2024_IMG_1593.jpg",hint:"Rally-bred AWD sedan"},
  {make:"Toyota",model:"MR2",year:1989,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/1993ToyotaMR2Hardtop.jpg/960px-1993ToyotaMR2Hardtop.jpg",hint:"Mid-engine Toyota"},
  {make:"Mazda",model:"Miata MX-5",year:1990,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Mazda_Roadster_%28MX-5%29_by_Negawa_Bridge_%28cropped%29.jpg/960px-Mazda_Roadster_%28MX-5%29_by_Negawa_Bridge_%28cropped%29.jpg",hint:"Best-selling roadster"},
  {make:"Nissan",model:"Silvia S15",year:1999,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Nissan_Silvia_S15_001.JPG/960px-Nissan_Silvia_S15_001.JPG",hint:"Drift favorite coupe"},
  {make:"Datsun",model:"240Z",year:1970,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/1970-1973_Nissan_Fairlady_Z.jpg/960px-1970-1973_Nissan_Fairlady_Z.jpg",hint:"Affordable sports car icon"},
  {make:"Lexus",model:"LFA",year:2010,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Lexus_LFA_001.JPG/960px-Lexus_LFA_001.JPG",hint:"V10 carbon-fiber supercar"},
  {make:"Toyota",model:"Land Cruiser",year:1980,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/2021_Toyota_Land_Cruiser_300_3.4_ZX_%28Colombia%29_front_view_04.png/960px-2021_Toyota_Land_Cruiser_300_3.4_ZX_%28Colombia%29_front_view_04.png",hint:"Legendary off-roader"},
  {make:"Suzuki",model:"Cappuccino",year:1991,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Suzuki_Cappuccino_front_20090514.jpg/960px-Suzuki_Cappuccino_front_20090514.jpg",hint:"Tiny kei sports car"},
  {make:"Honda",model:"Beat",year:1991,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Honda_Beat_PP1_front.jpg/960px-Honda_Beat_PP1_front.jpg",hint:"Mid-engine kei roadster"},
  {make:"Autozam",model:"AZ-1",year:1992,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Autozam_AZ-1_001.JPG/960px-Autozam_AZ-1_001.JPG",hint:"Gullwing kei car"},
  {make:"Mercedes-Benz",model:"190E",year:1984,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/1993_190E_2.3.jpg/960px-1993_190E_2.3.jpg",hint:"Baby Benz sedan"},
  {make:"Audi",model:"Quattro",year:1980,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Audi_Quattro_green.jpg/960px-Audi_Quattro_green.jpg",hint:"Rally homologation AWD"},
  {make:"BMW",model:"3 Series E30",year:1982,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/BMW_E30_in_silver_%28facelift%29%2C_front_left_2024-08-18.jpg/960px-BMW_E30_in_silver_%28facelift%29%2C_front_left_2024-08-18.jpg",hint:"Compact 80s BMW"},
  {make:"Porsche",model:"918 Spyder",year:2013,region:"germany",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Porsche_918_Spyder_IAA_2013.jpg/960px-Porsche_918_Spyder_IAA_2013.jpg",hint:"Hybrid hypercar"},
  {make:"Mercedes-Benz",model:"SL",year:1989,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Mercedes-AMG_SL_43_IMG_8050.jpg/960px-Mercedes-AMG_SL_43_IMG_8050.jpg",hint:"Grand touring roadster"},
  {make:"Audi",model:"R8",year:2006,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/2018_Audi_R8_Coupe_V10_plus_Front.jpg/960px-2018_Audi_R8_Coupe_V10_plus_Front.jpg",hint:"German everyday supercar"},
  {make:"Volkswagen",model:"Beetle",year:1968,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/VW_K%C3%A4fer_Baujahr_1966.jpg/960px-VW_K%C3%A4fer_Baujahr_1966.jpg",hint:"People's car"},
  {make:"Opel",model:"Manta",year:1975,region:"germany",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Opel_Manta_A_at_Schaffen-Diest_in_2018.jpg/960px-Opel_Manta_A_at_Schaffen-Diest_in_2018.jpg",hint:"German coupe cult classic"},
  {make:"BMW",model:"Z3",year:1996,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/1999_BMW_Z3_2.3_roadster%2C_front_right%2C_08-24-2024.jpg/960px-1999_BMW_Z3_2.3_roadster%2C_front_right%2C_08-24-2024.jpg",hint:"Bond roadster"},
  {make:"Porsche",model:"Cayman",year:2005,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Porsche_718_Boxster_Spyder_IMG_2961.jpg/960px-Porsche_718_Boxster_Spyder_IMG_2961.jpg",hint:"Mid-engine Porsche"},
  {make:"Chevrolet",model:"Camaro",year:1969,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/2019_Chevrolet_Camaro_2SS_6.2L_front_3.16.19.jpg/960px-2019_Chevrolet_Camaro_2SS_6.2L_front_3.16.19.jpg",hint:"Mustang's rival"},
  {make:"Pontiac",model:"Firebird Trans Am",year:1977,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/d/d3/TransAm1970.jpg",hint:"Smokey and the Bandit car"},
  {make:"Ford",model:"GT40",year:1966,region:"usa",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/GT40_at_Goodwood.jpg/960px-GT40_at_Goodwood.jpg",hint:"Le Mans winner"},
  {make:"Plymouth",model:"Barracuda",year:1970,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/1970_Plymouth_%27Cuda_%2828085938680%29.jpg/960px-1970_Plymouth_%27Cuda_%2828085938680%29.jpg",hint:"70s muscle car"},
  {make:"Cadillac",model:"Eldorado",year:1959,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/67_Cadillac_Eldorado_%2814277560774%29_cropped.jpg/960px-67_Cadillac_Eldorado_%2814277560774%29_cropped.jpg",hint:"Fin-era American luxury"},
  {make:"Dodge",model:"Viper",year:1992,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/%22_14_Fiat-Chrysler_SRT_Viper_GTS_%28cropped%29.jpg/960px-%22_14_Fiat-Chrysler_SRT_Viper_GTS_%28cropped%29.jpg",hint:"V10 American sports car"},
  {make:"Jeep",model:"Wrangler",year:1987,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/2018_Jeep_Wrangler_Sahara_Unlimited_Multijet_2.1_Front.jpg/960px-2018_Jeep_Wrangler_Sahara_Unlimited_Multijet_2.1_Front.jpg",hint:"Off-road icon"},
  {make:"Tesla",model:"Model S",year:2012,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Tesla_Model_S_%28Facelift_ab_04-2016%29_%28cropped%29.jpg/960px-Tesla_Model_S_%28Facelift_ab_04-2016%29_%28cropped%29.jpg",hint:"Electric sedan pioneer"},
  {make:"Buick",model:"Grand National",year:1987,region:"usa",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/2020_Buick_Regal_Sportback_%28United_States%29_front_view_%28cropped%29.jpg/960px-2020_Buick_Regal_Sportback_%28United_States%29_front_view_%28cropped%29.jpg",hint:"Turbo V6 sleeper"},
  {make:"AMC",model:"Gremlin",year:1970,region:"usa",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Gremlin_side_%285903000893%29.jpg/960px-Gremlin_side_%285903000893%29.jpg",hint:"Odd American compact"},
  {make:"DeLorean",model:"DMC-12",year:1981,region:"usa",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/2/2c/Delorean_DMC-12_side.jpg",hint:"Back to the Future car"},
  {make:"Citroën",model:"DS",year:1955,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Bornholm_Rundt_2012_%282012-07-08%29%2C_by_Klugschnacker_modified.jpg/960px-Bornholm_Rundt_2012_%282012-07-08%29%2C_by_Klugschnacker_modified.jpg",hint:"Futuristic French sedan"},
  {make:"Citroën",model:"2CV",year:1948,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Citroen_2CV_1X7A7979.jpg/960px-Citroen_2CV_1X7A7979.jpg",hint:"Minimalist French classic"},
  {make:"Renault",model:"5 Turbo",year:1980,region:"france",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/1981_Renault_5_Turbo_LC23.jpg/960px-1981_Renault_5_Turbo_LC23.jpg",hint:"Mid-engine rally hatch"},
  {make:"Bugatti",model:"Veyron",year:2005,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Bugatti_Veyron_16.4_%E2%80%93_Frontansicht_%281%29%2C_5._April_2012%2C_D%C3%BCsseldorf.jpg/960px-Bugatti_Veyron_16.4_%E2%80%93_Frontansicht_%281%29%2C_5._April_2012%2C_D%C3%BCsseldorf.jpg",hint:"Record-breaking hypercar"},
  {make:"Peugeot",model:"405",year:1987,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Peugeot_405_SRI_1992_%28cropped%29.jpg/960px-Peugeot_405_SRI_1992_%28cropped%29.jpg",hint:"French family sedan"},
  {make:"Alfa Romeo",model:"Giulia",year:1962,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Alfa_Romeo_Giulia_Super_%28cropped%29.jpg/960px-Alfa_Romeo_Giulia_Super_%28cropped%29.jpg",hint:"Classic Italian sedan"},
  {make:"Fiat",model:"500",year:1957,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/1970_Fiat_500_L_--_2011_DC_1.jpg/960px-1970_Fiat_500_L_--_2011_DC_1.jpg",hint:"Iconic Italian city car"},
  {make:"Lancia",model:"Delta Integrale",year:1987,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Lancia_Delta_LX_2012_02.jpg/960px-Lancia_Delta_LX_2012_02.jpg",hint:"Rally champion hatchback"},
  {make:"Ferrari",model:"F40",year:1987,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/F40_Ferrari_20090509.jpg/960px-F40_Ferrari_20090509.jpg",hint:"Last Enzo-approved Ferrari"},
  {make:"Lamborghini",model:"Diablo",year:1990,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/1995_Lamborghini_Diablo_SE_30.jpg/960px-1995_Lamborghini_Diablo_SE_30.jpg",hint:"90s wedge supercar"},
  {make:"Maserati",model:"Ghibli",year:1967,region:"italy",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/2018_Maserati_Ghibli_GranLusso_Diesel_3.0_facelift_Front.jpg/960px-2018_Maserati_Ghibli_GranLusso_Diesel_3.0_facelift_Front.jpg",hint:"Italian GT rival to Ferrari"},
  {make:"Alfa Romeo",model:"4C",year:2013,region:"italy",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Festival_automobile_international_2014_-_Alfa_Romeo_4C_-_009.jpg/960px-Festival_automobile_international_2014_-_Alfa_Romeo_4C_-_009.jpg",hint:"Lightweight carbon coupe"},
  {make:"Mini",model:"Cooper",year:1959,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Mini_One_%28R50%29_%E2%80%93_Frontansicht%2C_12._Juni_2011%2C_D%C3%BCsseldorf.jpg/960px-Mini_One_%28R50%29_%E2%80%93_Frontansicht%2C_12._Juni_2011%2C_D%C3%BCsseldorf.jpg",hint:"British icon"},
  {make:"Land Rover",model:"Defender",year:1983,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/2015_Land_Rover_Defender_%28L316_MY15%29_90_3-door_wagon_%282015-10-24%29_01.jpg/960px-2015_Land_Rover_Defender_%28L316_MY15%29_90_3-door_wagon_%282015-10-24%29_01.jpg",hint:"Rugged British off-roader"},
  {make:"Lotus",model:"Esprit",year:1976,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/1999_Lotus_Esprit_V8_type_918.jpg/960px-1999_Lotus_Esprit_V8_type_918.jpg",hint:"Bond submarine car"},
  {make:"McLaren",model:"F1",year:1992,region:"uk",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/1996_McLaren_F1_Chassis_No_63_6.1_Front.jpg/960px-1996_McLaren_F1_Chassis_No_63_6.1_Front.jpg",hint:"Center-seat hypercar legend"},
  {make:"Triumph",model:"Spitfire",year:1962,region:"uk",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Triumph_Spitfire_IV_%282014-09-13_7035%29.jpg/960px-Triumph_Spitfire_IV_%282014-09-13_7035%29.jpg",hint:"British roadster"},
  {make:"Rolls-Royce",model:"Silver Shadow",year:1965,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Rolls_Royce_Silver_Shadow_%281971%29.jpg/960px-Rolls_Royce_Silver_Shadow_%281971%29.jpg",hint:"Ultimate British luxury"},
  {make:"Jaguar",model:"XJ220",year:1992,region:"uk",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/JaguarXJ220.jpg/960px-JaguarXJ220.jpg",hint:"Once world's fastest car"},
  {make:"Trabant",model:"601",year:1963,region:"germany",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/3/38/1988_VEB_Sachenring_Trabant_P601S_Beige_%281_bearb_Sp%29_%28cropped%29.jpg",hint:"East German icon"},
  {make:"Citroën",model:"SM",year:1970,region:"france",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Citroen_SM_%281972%29_-_15340846543.jpg/960px-Citroen_SM_%281972%29_-_15340846543.jpg",hint:"Maserati-engined French GT"},
  {make:"TVR",model:"Griffith",year:1991,region:"uk",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/TVR_Griffith_-_Flickr_-_mick_-_Lumix.jpg/960px-TVR_Griffith_-_Flickr_-_mick_-_Lumix.jpg",hint:"Raw British sports car"},
  {make:"Reliant",model:"Robin",year:1973,region:"uk",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/1977_Reliant_Robin_850_%2814136529926%29_%28cropped%29.jpg/960px-1977_Reliant_Robin_850_%2814136529926%29_%28cropped%29.jpg",hint:"Three-wheeled British oddity"},
  {make:"Vector",model:"W8",year:1989,region:"usa",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/VectorW8.jpg/960px-VectorW8.jpg",hint:"Obscure American supercar"},
];

let mode='worldwide',queue=[],cur=null,score=0,idx=0,answered=false,timerInt=null,tLeft=30;
const TOTAL=10;

const cv=document.getElementById('bg'),cx=cv.getContext('2d');
let lns=[];
function initBg(){cv.width=cv.offsetWidth||640;cv.height=cv.offsetHeight||580;lns=Array.from({length:16},()=>({x:Math.random()*cv.width,y:Math.random()*cv.height,len:40+Math.random()*100,spd:0.3+Math.random()*0.7,op:0.03+Math.random()*0.06}));}
function drawBg(){cx.clearRect(0,0,cv.width,cv.height);lns.forEach(l=>{cx.beginPath();cx.moveTo(l.x,l.y);cx.lineTo(l.x+l.len,l.y);cx.strokeStyle=`rgba(200,169,110,${l.op})`;cx.lineWidth=1;cx.stroke();l.x+=l.spd;if(l.x>cv.width+l.len)l.x=-l.len;});requestAnimationFrame(drawBg);}
initBg();drawBg();

function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000);}

const MODE_TAG={worldwide:'Worldwide',japan:'Japan',germany:'Germany',usa:'USA',france:'France',italy:'Italy',uk:'UK',niche:'Niche',timeattack:'Time Attack'};

function go(dest){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  if(dest==='home'){document.getElementById('s-home').classList.add('active');return;}
  if(dest==='regional'){document.getElementById('s-regional').classList.add('active');return;}
  if(dest==='leaderboard'){document.getElementById('s-leaderboard').classList.add('active');initLeaderboard();return;}
  mode=dest;
  document.getElementById('modeTag').textContent=MODE_TAG[dest]||dest;
  document.getElementById('s-game').classList.add('active');
  restart();
}

function shuffle(a){return [...a].sort(()=>Math.random()-0.5);}
function getQueue(){
  let p=mode==='niche'?CARS.filter(c=>c.niche):mode==='worldwide'||mode==='timeattack'?[...CARS]:CARS.filter(c=>c.region===mode);
  while(p.length<TOTAL)p=[...p,...p];
  return shuffle(p).slice(0,TOTAL);
}

function restart(){
  score=0;idx=0;answered=false;queue=getQueue();
  document.getElementById('scoreDisplay').textContent='0';
  document.getElementById('fb').style.display='none';
  document.getElementById('hintTxt').style.display='none';
  document.getElementById('nextBtn').style.display='none';
  document.getElementById('finalWrap').style.display='none';
  document.getElementById('subBtn').style.display='';
  document.querySelector('.fields-row').style.display='';
  document.getElementById('carImg').style.display='';
  clearTimer();resetInputs();loadCar();
}

function resetInputs(){['iMake','iModel','iYear'].forEach(id=>{const e=document.getElementById(id);e.value='';e.disabled=false;});}
function clearTimer(){if(timerInt){clearInterval(timerInt);timerInt=null;}document.getElementById('timer').style.display='none';}

function startTimer(){
  tLeft=30;const el=document.getElementById('timer');
  el.style.display='';el.className='g-timer';el.textContent='0:30';clearTimer();
  timerInt=setInterval(()=>{tLeft--;el.textContent=`0:${tLeft.toString().padStart(2,'0')}`;if(tLeft<=10)el.className='g-timer urgent';if(tLeft<=0){clearTimer();if(!answered)autoSubmit();}},1000);
}

function loadCar(){
  cur=queue[idx];
  document.getElementById('progress').textContent=`Car ${idx+1} of ${TOTAL}`;
  const wrap=document.getElementById('carImg');
  wrap.innerHTML='<i class="ti ti-loader-2" style="font-size:36px;color:#222;" aria-hidden="true"></i>';
  const img=new Image();
  img.onload=()=>{wrap.innerHTML='';img.style.cssText='width:100%;height:100%;object-fit:cover;';wrap.appendChild(img);};
  img.onerror=()=>{wrap.innerHTML=`<div style="color:#333;font-size:13px;text-align:center;">${cur.make} ${cur.model}<br><span style="font-size:11px;color:#2a2a2a;">image unavailable in sandbox</span></div>`;};
  img.src=cur.img;
  if(mode==='timeattack')startTimer();
  document.getElementById('iMake').focus();
}

// STRICT matching — strip special chars, require exact match
function clean(s){return s.toLowerCase().replace(/[^a-z0-9]/g,'').trim();}

function scoreGuess(mg,mol,yr){
  const res=[];let pts=0;

  if(mg){
    const hit = clean(mg) === clean(cur.make);
    const p=hit?1:0;pts+=p;
    res.push({label:'Make',detail:hit?cur.make:`Not ${cur.make}`,pts:p});
  }
  if(mol){
    const hit = clean(mol) === clean(cur.model);
    const p=hit?2:0;pts+=p;
    res.push({label:'Model',detail:hit?cur.model:`Not ${cur.model}`,pts:p});
  }
  if(yr){
    const yg=parseInt(yr),ya=cur.year;let p=0,d='';
    if(!isNaN(yg)){
      const df=Math.abs(yg-ya);
      if(df===0){p=2;d=`Exact — ${ya}`;}
      else if(df<=5){p=1;d=`Within 5 yrs — ${ya}`;}
      else{p=0;d=`Off by ${df} — ${ya}`;}
    }
    pts+=p;res.push({label:'Year',detail:d,pts:p});
  }
  return{pts,res};
}

function showPopup(res,total){
  const pop=document.getElementById('popup');
  document.getElementById('prows').innerHTML=res.map(r=>`<div class="prow ${r.pts>0?'hit':''}"><span>${r.label}: ${r.detail}</span><span>${r.pts>0?'+'+r.pts:'0'}</span></div>`).join('');
  document.getElementById('ptotal').textContent=`+${total} pts`;
  pop.className='popup show';
  setTimeout(()=>{pop.className='popup fade';},2500);
  setTimeout(()=>{pop.className='popup';},3600);
}

function autoSubmit(){
  answered=true;
  ['iMake','iModel','iYear'].forEach(id=>document.getElementById(id).disabled=true);
  const fb=document.getElementById('fb');fb.style.display='block';fb.className='fb wrong';
  fb.textContent=`Time's up — ${cur.make} ${cur.model} (${cur.year})`;
  document.getElementById('hintTxt').textContent=cur.hint;document.getElementById('hintTxt').style.display='block';
  document.getElementById('nextBtn').style.display='block';idx++;
}

function submit(){
  if(answered)return;
  const mg=document.getElementById('iMake').value.trim();
  const mol=document.getElementById('iModel').value.trim();
  const yr=document.getElementById('iYear').value.trim();
  if(!mg&&!mol&&!yr)return;
  clearTimer();answered=true;
  ['iMake','iModel','iYear'].forEach(id=>document.getElementById(id).disabled=true);
  const{pts,res}=scoreGuess(mg,mol,yr);
  score+=pts;document.getElementById('scoreDisplay').textContent=score;
  showPopup(res,pts);
  const fb=document.getElementById('fb');fb.style.display='block';
  const ans=`${cur.make} ${cur.model} (${cur.year})`;
  if(pts>=4){fb.className='fb correct';fb.textContent=`Nailed it — ${ans}`;}
  else if(pts>0){fb.className='fb partial';fb.textContent=`Partial — ${ans}`;}
  else{fb.className='fb wrong';fb.textContent=`Nope — ${ans}`;}
  document.getElementById('hintTxt').textContent=cur.hint;document.getElementById('hintTxt').style.display='block';
  document.getElementById('nextBtn').style.display='block';idx++;
}

function next(){
  if(idx>=TOTAL){showFinal();return;}
  answered=false;
  document.getElementById('fb').style.display='none';
  document.getElementById('hintTxt').style.display='none';
  document.getElementById('nextBtn').style.display='none';
  resetInputs();loadCar();
}

function showFinal(){
  clearTimer();
  document.getElementById('carImg').style.display='none';
  document.querySelector('.fields-row').style.display='none';
  document.getElementById('subBtn').style.display='none';
  document.getElementById('fb').style.display='none';
  document.getElementById('hintTxt').style.display='none';
  document.getElementById('nextBtn').style.display='none';
  document.getElementById('finalWrap').style.display='block';
  const max=TOTAL*5;
  document.getElementById('fScore').textContent=score;
  document.getElementById('fSub').textContent=`out of ${max} possible points`;
  const pct=score/max;
  document.getElementById('fComment').textContent=pct>=0.8?"Car guy certified.":pct>=0.5?"Decent — keep driving.":"Back to the lot.";
  document.getElementById('scoreSubmit').style.display='flex';
  document.getElementById('scoreSaved').style.display='none';
  document.getElementById('iName').value=localStorage.getItem('vc_name')||'';
}

async function submitScore(){
  const nameInput=document.getElementById('iName');
  const name=nameInput.value.trim();
  if(!name){nameInput.focus();return;}
  localStorage.setItem('vc_name',name);
  const max=TOTAL*5;
  const btn=document.querySelector('#scoreSubmit button');
  btn.disabled=true;
  try{
    const res=await fetch('/api/scores',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,mode,score,maxScore:max})
    });
    if(!res.ok)throw new Error('save failed');
    const data=await res.json();
    document.getElementById('scoreSubmit').style.display='none';
    const saved=document.getElementById('scoreSaved');
    saved.textContent=`Saved — ranked #${data.rank} of ${data.total} in ${MODE_TAG[mode]||mode}`;
    saved.style.display='block';
  }catch(e){
    toast('Could not save score — try again');
    btn.disabled=false;
  }
}

let lbMode='worldwide';
function initLeaderboard(){
  const tabs=document.getElementById('lbTabs');
  tabs.innerHTML=Object.keys(MODE_TAG).map(m=>
    `<button class="lb-tab ${m===lbMode?'active':''}" data-mode="${m}">${MODE_TAG[m]}</button>`
  ).join('');
  tabs.querySelectorAll('.lb-tab').forEach(btn=>{
    btn.onclick=()=>{lbMode=btn.dataset.mode;initLeaderboard();};
  });
  loadLeaderboard();
}

async function loadLeaderboard(){
  const list=document.getElementById('lbList');
  list.innerHTML='<div class="lb-empty">Loading…</div>';
  try{
    const res=await fetch(`/api/leaderboard?mode=${encodeURIComponent(lbMode)}`);
    const rows=await res.json();
    if(!rows.length){list.innerHTML='<div class="lb-empty">No scores yet — be the first.</div>';return;}
    list.innerHTML=rows.map((r,i)=>`<div class="lb-row"><span class="lb-rank">${i+1}</span><span class="lb-name">${escapeHtml(r.name)}</span><span class="lb-score">${r.score}/${r.maxScore}</span></div>`).join('');
  }catch(e){
    list.innerHTML='<div class="lb-empty">Could not load leaderboard.</div>';
  }
}

function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  if(e.target.id==='iName'){submitScore();return;}
  if(document.getElementById('s-game').classList.contains('active')){if(answered)next();else submit();}
});
