// ============================================================================
// REALISM — 112 Geographically Grounded Global Ecoregion & Landscape Profiles
// Inspired by WWF / RESOLVE Terrestrial Ecoregions of the World & Marine
// Ecoregions of the World (MEOW). Each profile encodes real geographic bounds,
// biogeographic realm, climate, lithology (rock type), flora guild, water
// regime, and seasonal dynamics so adjacent regions never look identical.
// ============================================================================
import { clamp, hypot, abs, sin, cos, DEG2RAD } from './math.js';

// Compact schema:
// [id, name, realm, biomeClass, lat, lon, radDeg, minElev, maxElev, lithology, floraGuild, waterType, tintRGB, climateNote]
const RAW_ECOREGIONS = [
  // --- NEOTROPICS (South & Central America) ---
  ['nt_amazon_west', 'Western Amazonian Moist Forests', 'Neotropics', 'tropical_rainforest', -4.5, -67.5, 11, 20, 450, 'sandstone', 'emergent_rainforest', 'fresh', [0.12, 0.34, 0.14], 'Equatorial humid'],
  ['nt_amazon_east', 'Eastern Amazonian Varzea & Floodplains', 'Neotropics', 'freshwater_wetland', -2.5, -55.0, 9, 0, 180, 'shale', 'floodplain_canopy', 'fresh', [0.14, 0.37, 0.16], 'Seasonal flood pulse'],
  ['nt_guiana_shield', 'Guiana Highlands & Tepui Tablelands', 'Neotropics', 'montane_forest', 5.2, -61.5, 6, 400, 2800, 'sandstone', 'cloud_forest', 'fresh', [0.16, 0.36, 0.19], 'Mist-draped mesas'],
  ['nt_atlantic_forest', 'Serra do Mar Atlantic Rainforest', 'Neotropics', 'tropical_rainforest', -22.5, -45.0, 7, 10, 1600, 'granite', 'coastal_rainforest', 'fresh', [0.15, 0.38, 0.17], 'Humid coastal escarpment'],
  ['nt_cerrado', 'Brazilian Cerrado Wooded Savanna', 'Neotropics', 'savanna', -14.5, -47.5, 10, 300, 1200, 'sandstone', 'neotropical_savanna', 'fresh', [0.46, 0.44, 0.21], 'Wet-dry tropical savanna'],
  ['nt_pantanal', 'Pantanal Flooded Grasslands & Marshes', 'Neotropics', 'freshwater_wetland', -17.5, -57.0, 5, 70, 220, 'shale', 'wetland_marsh', 'fresh', [0.22, 0.40, 0.22], 'Seasonal inland wetland'],
  ['nt_gran_chaco', 'Gran Chaco Dry Thorn Forests', 'Neotropics', 'tropical_dry_forest', -23.0, -61.0, 7, 80, 420, 'sandstone', 'dry_thorn_forest', 'fresh', [0.44, 0.41, 0.24], 'Semi-arid seasonal'],
  ['nt_pampas', 'Humid Pampas Temperate Grasslands', 'Neotropics', 'grassland', -35.5, -60.5, 8, 5, 350, 'shale', 'temperate_prairie', 'fresh', [0.42, 0.48, 0.24], 'Temperate plains'],
  ['nt_patagonia_steppe', 'Patagonian Cold Steppe & Mesetas', 'Neotropics', 'cold_desert', -45.5, -69.5, 8, 50, 1400, 'basalt', 'cold_scrub', 'fresh', [0.54, 0.47, 0.35], 'Windswept rain shadow'],
  ['nt_magellanic', 'Magellanic Subpolar Beech Forests', 'Neotropics', 'temperate_rainforest', -51.5, -73.0, 5, 0, 1500, 'granite', 'subpolar_broadleaf', 'fresh', [0.20, 0.33, 0.24], 'Glacial fjords'],
  ['nt_valdivian', 'Valdivian Temperate Rainforests', 'Neotropics', 'temperate_rainforest', -40.5, -72.5, 5, 0, 1800, 'volcanic', 'temperate_rainforest', 'fresh', [0.16, 0.35, 0.20], 'High rainfall cool coastal'],
  ['nt_atacama', 'Atacama Hyper-Arid Desert & Salars', 'Neotropics', 'hot_desert', -23.5, -69.2, 6, 100, 3200, 'desert_sandstone', 'hyperarid_desert', 'none', [0.74, 0.56, 0.39], 'Hyper-arid coastal desert'],
  ['nt_central_andes', 'Central Andean Puna & Altiplano', 'Neotropics', 'alpine', -16.5, -69.0, 7, 3200, 6600, 'volcanic', 'alpine_tussock', 'fresh', [0.56, 0.52, 0.44], 'High-altitude plateau'],
  ['nt_northern_andes', 'Northern Andean Paramo & Cloud Forest', 'Neotropics', 'montane_forest', 3.5, -75.5, 7, 1500, 5200, 'volcanic', 'paramo_cloud', 'fresh', [0.24, 0.40, 0.24], 'Equatorial alpine mist'],
  ['nt_llanos', 'Orinoco Llanos Tropical Flooded Savanna', 'Neotropics', 'savanna', 7.5, -68.5, 6, 40, 280, 'shale', 'flooded_savanna', 'fresh', [0.42, 0.46, 0.22], 'Monsoonal tropical plains'],
  ['nt_choco_darien', 'Choco-Darien Pluvial Rainforests', 'Neotropics', 'tropical_rainforest', 5.5, -77.2, 5, 0, 1200, 'basalt', 'emergent_rainforest', 'fresh', [0.10, 0.32, 0.14], 'Extreme equatorial rain'],
  ['nt_yucatan_karst', 'Yucatan Moist & Karst Cenote Forests', 'Neotropics', 'tropical_dry_forest', 19.5, -88.5, 5, 0, 220, 'karst', 'karst_jungle', 'fresh', [0.20, 0.39, 0.19], 'Limestone sinkhole karst'],
  ['nt_amazon_mangroves', 'Amazon-Orinoco-Maranhao Mangroves', 'Neotropics', 'mangrove', 0.5, -49.0, 6, -2, 18, 'shale', 'stilt_mangrove', 'brackish', [0.13, 0.31, 0.18], 'Tidal estuarine swamps'],
  ['nt_central_am_cloud', 'Mesoamerican Montane Cloud Forests', 'Neotropics', 'montane_forest', 14.5, -87.5, 6, 900, 3200, 'volcanic', 'cloud_forest', 'fresh', [0.18, 0.37, 0.21], 'Volcanic cordillera'],
  ['nt_galapagos', 'Galapagos Volcanic Xeric Scrub', 'Neotropics', 'volcanic_island', -0.6, -90.6, 2.5, 0, 1700, 'volcanic', 'xeric_succulent', 'none', [0.45, 0.41, 0.33], 'Equatorial lava islands'],

  // --- NEARCTIC (North America) ---
  ['na_pacific_nw', 'Pacific Northwest Coastal Temperate Rainforest', 'Nearctic', 'temperate_rainforest', 47.5, -123.5, 7, 0, 2200, 'basalt', 'giant_conifer', 'fresh', [0.14, 0.30, 0.17], 'Marine fog conifers'],
  ['na_sierra_nevada', 'Sierra Nevada Subalpine Conifer Forests', 'Nearctic', 'montane_forest', 38.0, -119.5, 5, 1100, 4200, 'granite', 'montane_conifer', 'fresh', [0.23, 0.35, 0.21], 'Granite batholith peaks'],
  ['na_rockies', 'Rocky Mountain Alpine & Lodgepole Forests', 'Nearctic', 'alpine', 45.5, -111.5, 9, 1400, 4400, 'granite', 'montane_conifer', 'fresh', [0.28, 0.36, 0.24], 'Continental divide'],
  ['na_great_plains', 'Great Plains Shortgrass & Tallgrass Prairie', 'Nearctic', 'prairie', 41.5, -101.0, 11, 250, 1500, 'sandstone', 'temperate_prairie', 'fresh', [0.46, 0.48, 0.26], 'Continental prairie'],
  ['na_sonoran', 'Sonoran & Mojave Saguaro Deserts', 'Nearctic', 'hot_desert', 33.0, -113.0, 7, 50, 1500, 'desert_sandstone', 'cactus_succulent', 'none', [0.68, 0.54, 0.36], 'Bimodal desert rain'],
  ['na_colorado_plateau', 'Colorado Plateau Red-Rock Canyons', 'Nearctic', 'cold_desert', 37.2, -110.5, 5, 1000, 2800, 'sandstone', 'pinyon_juniper', 'fresh', [0.69, 0.42, 0.26], 'Stratified canyon mesas'],
  ['na_california_chaparral', 'California Coastal Chaparral & Oak Woodlands', 'Nearctic', 'mediterranean', 35.5, -120.0, 5, 0, 1600, 'sandstone', 'mediterranean_oak', 'fresh', [0.43, 0.43, 0.25], 'Dry summer coastal'],
  ['na_appalachian', 'Appalachian Mixed Broadleaf Deciduous Forests', 'Nearctic', 'temperate_forest', 37.5, -81.0, 8, 150, 1900, 'limestone', 'deciduous_broadleaf', 'fresh', [0.22, 0.39, 0.18], 'Humid four-season woods'],
  ['na_mississippi_bayou', 'Mississippi Delta & Cypress Swamps', 'Nearctic', 'swamp', 30.0, -90.2, 5, -1, 60, 'shale', 'cypress_bayou', 'fresh', [0.16, 0.32, 0.19], 'Subtropical alluvial bayou'],
  ['na_everglades', 'Everglades Sawgrass Marshes & Mangroves', 'Nearctic', 'freshwater_wetland', 25.8, -80.8, 3.5, -1, 15, 'limestone', 'wetland_marsh', 'fresh', [0.22, 0.41, 0.21], 'Karst sheet-flow marsh'],
  ['na_great_lakes', 'Laurentian Great Lakes Pine-Hemlock Forests', 'Nearctic', 'temperate_forest', 45.5, -84.5, 7, 170, 550, 'glacial', 'mixed_conifer_broadleaf', 'fresh', [0.21, 0.36, 0.20], 'Lacustrine glacial shield'],
  ['na_canadian_taiga', 'Canadian Shield Boreal Taiga', 'Nearctic', 'boreal_forest', 56.5, -96.0, 14, 100, 750, 'granite', 'boreal_conifer', 'fresh', [0.17, 0.28, 0.19], 'Subarctic spruce lakes'],
  ['na_alaska_range', 'Alaska Range Glaciers & Boreal Valleys', 'Nearctic', 'alpine', 63.0, -150.0, 8, 100, 5800, 'glacial', 'boreal_alpine', 'fresh', [0.35, 0.41, 0.38], 'Subarctic glacier peaks'],
  ['na_arctic_tundra', 'Canadian Low & High Arctic Tundra', 'Arctic', 'arctic_tundra', 69.5, -105.0, 14, 0, 600, 'glacial', 'tundra_lichen', 'fresh', [0.46, 0.49, 0.42], 'Permafrost barrens'],
  ['na_greenland_ice', 'Greenland Glacial Ice Sheet & Nunataks', 'Arctic', 'polar_ice', 74.0, -42.0, 13, 0, 3200, 'glacial', 'polar_ice', 'ice', [0.85, 0.90, 0.95], 'Continental ice cap'],
  ['na_sierra_madre', 'Sierra Madre Pine-Oak Highlands', 'Nearctic', 'montane_forest', 24.5, -105.5, 7, 1200, 3400, 'volcanic', 'montane_conifer', 'fresh', [0.28, 0.38, 0.22], 'Highland pine-oak'],

  // --- AFROTROPICS (Africa & Madagascar) ---
  ['af_sahara_west', 'Western Sahara Erg & Sand Seas', 'Afrotropics', 'hot_desert', 23.0, -3.0, 13, 50, 900, 'desert_sandstone', 'erg_dunes', 'none', [0.78, 0.62, 0.40], 'Hyper-arid dune sea'],
  ['af_sahara_east', 'Tibesti-Ahaggar Saharan Massifs & Hamada', 'Afrotropics', 'hot_desert', 22.5, 19.0, 13, 150, 3200, 'volcanic', 'rock_desert', 'none', [0.73, 0.56, 0.38], 'Volcanic desert plateaus'],
  ['af_sahel', 'Sahelian Acacia Dry Savanna Belt', 'Afrotropics', 'savanna', 14.5, 10.0, 14, 150, 750, 'sandstone', 'acacia_savanna', 'fresh', [0.60, 0.50, 0.28], 'Semi-arid transition'],
  ['af_congo_basin', 'Congolian Equatorial Lowland Rainforests', 'Afrotropics', 'tropical_rainforest', 0.5, 21.5, 9, 250, 900, 'sandstone', 'emergent_rainforest', 'fresh', [0.11, 0.33, 0.14], 'Equatorial river rainforest'],
  ['af_virunga_albertine', 'Albertine Rift & Virunga Montane Cloud Forests', 'Afrotropics', 'montane_forest', -1.4, 29.5, 4.5, 1200, 4500, 'volcanic', 'cloud_forest', 'fresh', [0.16, 0.36, 0.18], 'Volcanic gorilla highlands'],
  ['af_serengeti', 'Serengeti-Mara Acacia Savanna & Kopjes', 'Afrotropics', 'savanna', -2.4, 34.8, 7, 900, 2100, 'granite', 'acacia_savanna', 'fresh', [0.54, 0.48, 0.24], 'Migratory rift plains'],
  ['af_ethiopian_highlands', 'Ethiopian Montane Moorlands & Escarpments', 'Afrotropics', 'alpine', 9.5, 39.2, 6, 1600, 4400, 'basalt', 'alpine_tussock', 'fresh', [0.34, 0.41, 0.23], 'Afro-alpine basalt plateau'],
  ['af_miombo', 'Zambezian Miombo Broadleaf Woodlands', 'Afrotropics', 'tropical_dry_forest', -13.0, 27.5, 9, 600, 1500, 'granite', 'dry_woodland', 'fresh', [0.36, 0.43, 0.21], 'Seasonal dry woodland'],
  ['af_okavango', 'Okavango Inland Delta & Flooded Reedbeds', 'Afrotropics', 'freshwater_wetland', -19.2, 22.8, 4, 900, 1050, 'sandstone', 'wetland_marsh', 'fresh', [0.24, 0.43, 0.23], 'Desert river delta'],
  ['af_kalahari', 'Kalahari Xeric Acacia Savanna', 'Afrotropics', 'hot_desert', -23.5, 21.5, 6, 800, 1250, 'desert_sandstone', 'xeric_scrub', 'none', [0.68, 0.52, 0.32], 'Semi-arid sand basin'],
  ['af_namib', 'Namib & Skeleton Coast Red Dunes', 'Afrotropics', 'hot_desert', -22.5, 14.4, 5, 0, 800, 'desert_sandstone', 'erg_dunes', 'none', [0.76, 0.46, 0.27], 'Coastal fog iron-oxide dunes'],
  ['af_fynbos', 'Cape Floristic Fynbos & Table Mountain', 'Afrotropics', 'mediterranean', -33.6, 19.5, 4, 0, 1900, 'sandstone', 'mediterranean_shrub', 'fresh', [0.35, 0.41, 0.24], 'Winter-rain shrubland'],
  ['af_drakensberg', 'Drakensberg Maloti Basalt Highlands', 'Afrotropics', 'alpine', -29.2, 28.8, 4.5, 1400, 3400, 'basalt', 'alpine_tussock', 'fresh', [0.36, 0.42, 0.26], 'Basalt escarpment peaks'],
  ['af_madagascar_east', 'Madagascar Lowland Spiny & Humid Forests', 'Madagascar', 'tropical_rainforest', -19.0, 47.0, 5, 0, 2400, 'granite', 'emergent_rainforest', 'fresh', [0.20, 0.38, 0.19], 'Endemic island biodiversity'],
  ['af_atlas', 'Atlas Mountains Cedar & Mediterranean Scrub', 'Palearctic', 'mediterranean', 32.0, -5.5, 6, 400, 4100, 'limestone', 'mediterranean_oak', 'fresh', [0.46, 0.42, 0.28], 'North African alpine ridge'],
  ['af_nile_delta', 'Nile Valley & Delta Alluvial Wetlands', 'Palearctic', 'freshwater_wetland', 29.5, 31.2, 3.5, 0, 120, 'shale', 'wetland_marsh', 'fresh', [0.25, 0.44, 0.22], 'Riverine oasis'],

  // --- PALEARCTIC (Europe, North & Central Asia) ---
  ['pa_mediterranean', 'Mediterranean Sclerophyll Woodlands & Olive Groves', 'Palearctic', 'mediterranean', 40.0, 12.0, 10, 0, 1800, 'limestone', 'mediterranean_oak', 'fresh', [0.42, 0.45, 0.27], 'Dry summer limestone hills'],
  ['pa_alps', 'European Alps Glaciated Peaks & Montane Meadows', 'Palearctic', 'alpine', 46.5, 10.0, 5.5, 800, 4800, 'granite', 'alpine_conifer', 'fresh', [0.42, 0.47, 0.44], 'Glaciated alpine peaks'],
  ['pa_west_europe', 'Western European Atlantic Mixed Broadleaf Forests', 'Palearctic', 'temperate_forest', 49.0, 3.5, 8, 0, 900, 'limestone', 'deciduous_broadleaf', 'fresh', [0.24, 0.41, 0.20], 'Maritime broadleaf'],
  ['pa_central_europe', 'Central European Beech & Carpathian Mixed Forests', 'Palearctic', 'temperate_forest', 50.0, 18.0, 8, 120, 2400, 'limestone', 'deciduous_broadleaf', 'fresh', [0.23, 0.39, 0.19], 'Continental deciduous'],
  ['pa_scandinavia', 'Scandinavian Fjords & Boreal Conifer Taiga', 'Palearctic', 'boreal_forest', 63.0, 15.0, 9, 0, 2200, 'granite', 'boreal_conifer', 'fresh', [0.20, 0.31, 0.22], 'Glaciated granite fjords'],
  ['pa_iceland', 'Icelandic Subpolar Basalt & Geothermal Mossfields', 'Palearctic', 'arctic_tundra', 64.9, -18.5, 3.5, 0, 2100, 'basalt', 'tundra_lichen', 'fresh', [0.34, 0.41, 0.32], 'Subarctic basalt lava'],
  ['pa_pontic_steppe', 'Pontic-Caspian Temperate Grasslands & Steppe', 'Palearctic', 'steppe', 48.0, 44.0, 10, -25, 450, 'shale', 'temperate_prairie', 'fresh', [0.49, 0.49, 0.29], 'Vast continental steppe'],
  ['pa_caucasus', 'Caucasus Mixed Montane & Subalpine Forests', 'Palearctic', 'montane_forest', 42.6, 44.5, 5, 500, 5400, 'granite', 'alpine_conifer', 'fresh', [0.29, 0.39, 0.27], 'Steep fold mountains'],
  ['pa_arabian_desert', 'Arabian Peninsula Rub al-Khali Sand Desert', 'Palearctic', 'hot_desert', 22.5, 47.0, 10, 0, 1400, 'desert_sandstone', 'erg_dunes', 'none', [0.79, 0.63, 0.42], 'Hyper-arid dune desert'],
  ['pa_iranian_plateau', 'Zagros & Iranian Montane Steppe', 'Palearctic', 'cold_desert', 34.0, 52.0, 9, 700, 3800, 'limestone', 'dry_scrub', 'fresh', [0.58, 0.49, 0.34], 'Arid mountain basins'],
  ['pa_kazakh_steppe', 'Kazakh Steppe & Aral Semi-Desert', 'Palearctic', 'steppe', 49.5, 67.0, 11, 50, 900, 'sandstone', 'temperate_prairie', 'fresh', [0.53, 0.50, 0.31], 'Continental semi-arid'],
  ['pa_tian_shan_pamir', 'Tian Shan & Pamir Alpine Valleys', 'Palearctic', 'alpine', 40.5, 74.5, 8, 1600, 7000, 'granite', 'alpine_tussock', 'fresh', [0.46, 0.49, 0.45], 'Glacial high Asia'],
  ['pa_west_siberia', 'West Siberian Taiga & Peatland Bogs', 'Palearctic', 'boreal_forest', 60.5, 75.0, 13, 20, 350, 'shale', 'boreal_conifer', 'fresh', [0.18, 0.30, 0.20], 'Vast boreal wetlands'],
  ['pa_east_siberia', 'East Siberian Larch Taiga & Lake Baikal', 'Palearctic', 'boreal_forest', 61.5, 112.0, 15, 200, 1600, 'granite', 'boreal_conifer', 'fresh', [0.21, 0.31, 0.21], 'Extreme continental larch'],
  ['pa_siberian_tundra', 'Siberian Arctic Coastal Tundra', 'Arctic', 'arctic_tundra', 71.5, 102.0, 16, 0, 500, 'glacial', 'tundra_lichen', 'fresh', [0.48, 0.51, 0.45], 'High Arctic permafrost'],
  ['pa_kamchatka', 'Kamchatka Volcanic Tundra & Birch Taiga', 'Palearctic', 'volcanic_island', 56.0, 160.0, 5, 0, 4500, 'volcanic', 'boreal_alpine', 'fresh', [0.26, 0.34, 0.24], 'Active Pacific volcanoes'],
  ['pa_gobi', 'Gobi & Taklamakan Cold Interior Deserts', 'Palearctic', 'cold_desert', 42.0, 98.0, 12, 700, 2200, 'desert_sandstone', 'cold_scrub', 'none', [0.68, 0.57, 0.41], 'Continental rain-shadow'],
  ['pa_tibetan_plateau', 'Tibetan Plateau Alpine Steppe & Glaciers', 'Palearctic', 'alpine', 33.0, 88.0, 11, 3800, 7600, 'granite', 'alpine_tussock', 'fresh', [0.56, 0.54, 0.47], 'Roof of the World'],
  ['pa_manchuria', 'Manchurian & Amur Mixed Conifer-Broadleaf Forests', 'Palearctic', 'temperate_forest', 46.0, 131.0, 8, 100, 1400, 'granite', 'mixed_conifer_broadleaf', 'fresh', [0.21, 0.35, 0.19], 'Amur tiger forests'],
  ['pa_japan_alps', 'Japanese Temperate Forests & Volcanic Calderas', 'Palearctic', 'montane_forest', 36.0, 138.5, 5, 0, 3600, 'volcanic', 'bamboo_conifer', 'fresh', [0.19, 0.36, 0.21], 'Volcanic island arc'],

  // --- INDOMALAYA (South & Southeast Asia) ---
  ['im_himalayas', 'Himalayan Subalpine & Rhododendron Forests', 'Indomalaya', 'alpine', 28.0, 85.0, 8, 1200, 7600, 'granite', 'alpine_conifer', 'fresh', [0.36, 0.44, 0.39], 'Highest mountain wall'],
  ['im_sichuan_bamboo', 'Qionglai-Minshan Misty Bamboo Highlands', 'Indomalaya', 'bamboo_forest', 29.5, 103.5, 6, 600, 3600, 'karst', 'bamboo_grove', 'fresh', [0.17, 0.38, 0.19], 'Karst bamboo mist'],
  ['im_yangtze_plain', 'Yangtze River Alluvial Forests & Karst Peaks', 'Indomalaya', 'temperate_forest', 28.5, 113.5, 8, 20, 1200, 'karst', 'bamboo_broadleaf', 'fresh', [0.22, 0.40, 0.21], 'Humid subtropical karst'],
  ['im_thar', 'Thar Arid Thorn Scrub & Sand Dunes', 'Indomalaya', 'hot_desert', 27.0, 71.0, 5, 50, 450, 'desert_sandstone', 'xeric_scrub', 'none', [0.71, 0.57, 0.37], 'Monsoon-edge desert'],
  ['im_ganges_sundarbans', 'Sundarbans Tidal Mangroves & Gangetic Floodplain', 'Indomalaya', 'mangrove', 22.5, 89.0, 6, -1, 120, 'shale', 'stilt_mangrove', 'brackish', [0.14, 0.35, 0.19], 'World largest mangrove delta'],
  ['im_western_ghats', 'Western Ghats & Deccan Monsoon Forests', 'Indomalaya', 'tropical_rainforest', 14.5, 76.0, 7, 50, 2200, 'basalt', 'monsoon_rainforest', 'fresh', [0.17, 0.37, 0.18], 'Basalt trap escarpment'],
  ['im_indochina', 'Indochina Monsoon Terraces & Dry Dipterocarp', 'Indomalaya', 'tropical_dry_forest', 15.0, 102.0, 7, 20, 1400, 'karst', 'bamboo_broadleaf', 'fresh', [0.23, 0.41, 0.19], 'Seasonal tropical monsoon'],
  ['im_borneo_sumatra', 'Sundaland Equatorial Dipterocarp Rainforests', 'Indomalaya', 'tropical_rainforest', 0.5, 111.5, 10, 0, 3400, 'limestone', 'emergent_rainforest', 'fresh', [0.10, 0.33, 0.14], 'Equatorial island jungle'],
  ['im_philippines', 'Philippine Volcanic Archipelago Rainforests', 'Indomalaya', 'tropical_rainforest', 12.5, 122.5, 6, 0, 2600, 'volcanic', 'coastal_rainforest', 'fresh', [0.13, 0.36, 0.17], 'Typhoon volcanic islands'],

  // --- AUSTRALASIA & OCEANIA ---
  ['au_new_guinea', 'New Guinea Montane & Lowland Cloud Rainforests', 'Australasia', 'tropical_rainforest', -5.5, 142.0, 7, 0, 4600, 'limestone', 'emergent_rainforest', 'fresh', [0.12, 0.35, 0.16], 'Equatorial island cordillera'],
  ['au_queensland_wet', 'Queensland Wet Tropics & Coastal Atolls', 'Australasia', 'tropical_rainforest', -17.0, 145.6, 4.5, 0, 1400, 'granite', 'coastal_rainforest', 'fresh', [0.18, 0.38, 0.19], 'Reef-edge rainforest'],
  ['au_kimberley_savanna', 'Arnhem & Kimberley Tropical Eucalyptus Savanna', 'Australasia', 'savanna', -15.5, 130.0, 8, 0, 750, 'sandstone', 'dry_woodland', 'fresh', [0.54, 0.45, 0.25], 'Monsoonal red sandstone'],
  ['au_outback', 'Great Victoria & Simpson Red-Sand Outback', 'Australasia', 'hot_desert', -25.0, 131.5, 11, 80, 1100, 'desert_sandstone', 'xeric_scrub', 'none', [0.74, 0.43, 0.25], 'Iron-oxide desert plains'],
  ['au_southeast_euc', 'Southeast Australian Temperate Eucalyptus Forests', 'Australasia', 'temperate_forest', -35.5, 148.5, 6, 0, 2100, 'granite', 'deciduous_broadleaf', 'fresh', [0.23, 0.38, 0.22], 'Temperate gum forests'],
  ['au_tasmania', 'Tasmanian Cool Temperate Rainforests', 'Australasia', 'temperate_rainforest', -42.2, 146.5, 3, 0, 1500, 'basalt', 'temperate_rainforest', 'fresh', [0.16, 0.34, 0.20], 'Gondwanan wet forest'],
  ['au_nz_alps', 'Fiordland & Southern Alps Temperate Glaciers', 'Australasia', 'alpine', -44.0, 169.5, 4.5, 0, 3600, 'granite', 'temperate_rainforest', 'fresh', [0.24, 0.38, 0.29], 'Glaciated island alps'],
  ['au_polynesia', 'South Pacific Volcanic Atolls & Palms', 'Australasia', 'tropical_beach', -17.5, -149.5, 14, 0, 1800, 'coral_limestone', 'palm_atoll', 'fresh', [0.24, 0.44, 0.24], 'Trade-wind coral islands'],

  // --- ANTARCTIC & SUB-ANTARCTIC ---
  ['an_peninsula', 'Antarctic Peninsula Basalt Coast & Penguin Rookeries', 'Antarctic', 'sub_antarctic', -65.0, -63.0, 7, 0, 2200, 'basalt', 'polar_coast', 'ice', [0.68, 0.74, 0.80], 'Sub-Antarctic rocky coast'],
  ['an_ross_shelf', 'Ross Sea Glacial Ice Shelf & Pressure Ridges', 'Antarctic', 'polar_ice', -77.0, 170.0, 12, 0, 1200, 'glacial', 'polar_ice', 'ice', [0.86, 0.91, 0.96], 'Floating tabular ice shelf'],
  ['an_east_plateau', 'East Antarctic Polar Ice Plateau', 'Antarctic', 'polar_ice', -82.0, 65.0, 22, 1200, 4100, 'glacial', 'polar_ice', 'ice', [0.90, 0.94, 0.98], 'Highest coldest ice sheet'],
  ['an_west_ice', 'West Antarctic Marie Byrd Ice Sheet', 'Antarctic', 'polar_ice', -78.0, -110.0, 14, 200, 2600, 'glacial', 'polar_ice', 'ice', [0.87, 0.92, 0.97], 'Marine glacial ice sheet'],

  // --- MARINE ECOREGIONS (Coral Reefs, Kelp, Seagrass, Shelves, Abyssal Plains & Trenches) ---
  ['ma_gbr_coral', 'Great Barrier Reef & Coral Sea Atolls', 'Indo_Pacific', 'coral_reef', -17.5, 147.2, 6, -120, -1, 'coral_limestone', 'coral_kelp', 'marine', [0.10, 0.56, 0.64], 'Warm photic barrier reef'],
  ['ma_coral_triangle', 'Indo-Pacific Coral Triangle Reefs', 'Indo_Pacific', 'coral_reef', -2.0, 128.0, 11, -180, -1, 'coral_limestone', 'coral_kelp', 'marine', [0.09, 0.54, 0.63], 'Highest marine biodiversity'],
  ['ma_red_sea_reef', 'Red Sea & Arabian Coral Reefs', 'Indian_Ocean', 'coral_reef', 20.5, 38.5, 6, -180, -1, 'coral_limestone', 'coral_kelp', 'marine', [0.11, 0.50, 0.60], 'Warm hypersaline reef'],
  ['ma_caribbean_reef', 'Mesoamerican & Caribbean Coral Reefs', 'Caribbean', 'coral_reef', 18.0, -82.0, 9, -140, -1, 'coral_limestone', 'coral_kelp', 'marine', [0.10, 0.55, 0.65], 'Turquoise tropical reefs'],
  ['ma_bahamas_seagrass', 'Bahamas & Florida Seagrass Banks', 'Caribbean', 'seagrass_meadow', 24.5, -77.5, 5, -35, -1, 'coral_limestone', 'seagrass_reef', 'marine', [0.12, 0.58, 0.62], 'Carbonate sand flats'],
  ['ma_california_kelp', 'California Current Giant Kelp Forests', 'Pacific', 'kelp_forest', 36.0, -122.0, 6, -160, -1, 'coastal_rock', 'giant_kelp', 'marine', [0.08, 0.36, 0.44], 'Cold upwelling kelp'],
  ['ma_patagonia_kelp', 'Humboldt & Sub-Antarctic Kelp Shelves', 'Southern_Ocean', 'kelp_forest', -48.0, -66.0, 8, -220, -1, 'coastal_rock', 'giant_kelp', 'marine', [0.07, 0.32, 0.42], 'Nutrient-rich cold kelp'],
  ['ma_benguela_kelp', 'Benguela Upwelling Kelp Shelf', 'Atlantic', 'kelp_forest', -31.0, 16.5, 5, -200, -1, 'coastal_rock', 'giant_kelp', 'marine', [0.08, 0.34, 0.43], 'Cold Atlantic upwelling'],
  ['ma_north_sea_shelf', 'North Atlantic Continental Shelf', 'Atlantic', 'continental_shelf', 56.0, 2.0, 9, -240, -1, 'coastal_rock', 'shelf_benthic', 'marine', [0.08, 0.30, 0.42], 'Temperate shallow shelf'],
  ['ma_grand_banks', 'Grand Banks & Labrador Cold Shelf', 'Atlantic', 'continental_shelf', 46.0, -51.0, 8, -280, -1, 'glacial', 'shelf_benthic', 'marine', [0.07, 0.28, 0.41], 'Foggy subpolar shelf'],
  ['ma_med_seagrass', 'Mediterranean Posidonia Seagrass Meadows', 'Atlantic', 'seagrass_meadow', 37.5, 16.0, 9, -120, -1, 'limestone', 'seagrass_reef', 'marine', [0.09, 0.42, 0.54], 'Warm temperate sea'],
  ['ma_sargasso', 'Sargasso Sea Pelagic Gyre', 'Atlantic', 'pelagic_ocean', 28.0, -60.0, 15, -5400, -100, 'basalt', 'pelagic_drift', 'marine', [0.04, 0.20, 0.36], 'Oligotrophic blue gyre'],
  ['ma_mid_atlantic', 'Mid-Atlantic Ridge Hydrothermal Rift', 'Atlantic', 'deep_ocean', 12.0, -40.0, 18, -4800, -1600, 'basalt', 'abyssal_vent', 'marine', [0.03, 0.14, 0.28], 'Volcanic ocean spreading'],
  ['ma_south_atlantic', 'South Atlantic Abyssal Plains', 'Atlantic', 'deep_ocean', -30.0, -18.0, 22, -5500, -2500, 'basalt', 'abyssal_plain', 'marine', [0.03, 0.13, 0.26], 'Deep abyssal basin'],
  ['ma_mariana_trench', 'Mariana & Western Pacific Hadal Trench', 'Pacific', 'abyssal_trench', 18.0, 145.5, 11, -10800, -3500, 'basalt', 'abyssal_vent', 'marine', [0.02, 0.09, 0.20], 'Hadal subduction trench'],
  ['ma_coral_sea_trench', 'Coral Sea Abyssal Garden & Hydrothermal Trench', 'Pacific', 'abyssal_trench', -18.5, 149.2, 8, -6800, -12, 'basalt', 'coral_kelp', 'marine', [0.03, 0.16, 0.29], 'Hydrothermal reef trench'],
  ['ma_north_pacific', 'North Pacific Subarctic Pelagic Basin', 'Pacific', 'pelagic_ocean', 44.0, -162.0, 24, -5800, -1500, 'basalt', 'pelagic_drift', 'marine', [0.04, 0.18, 0.33], 'Stormy pelagic gyre'],
  ['ma_east_pacific', 'Eastern Tropical Pacific Galapagos Current', 'Pacific', 'pelagic_ocean', 4.0, -112.0, 24, -4600, -800, 'basalt', 'pelagic_drift', 'marine', [0.04, 0.22, 0.37], 'Equatorial upwelling'],
  ['ma_south_pacific', 'South Pacific Gyre & Tonga Trench', 'Pacific', 'deep_ocean', -28.0, -142.0, 26, -9800, -2000, 'basalt', 'abyssal_plain', 'marine', [0.03, 0.14, 0.27], 'Remotest ocean abyss'],
  ['ma_indian_ocean', 'Central Indian Ocean Monsoon Basin', 'Indian_Ocean', 'pelagic_ocean', -14.0, 78.0, 24, -5600, -1200, 'basalt', 'pelagic_drift', 'marine', [0.04, 0.21, 0.36], 'Monsoon pelagic sea'],
  ['ma_southern_ocean', 'Antarctic Circumpolar Southern Ocean', 'Southern_Ocean', 'pelagic_ocean', -60.0, 20.0, 26, -5200, -400, 'basalt', 'polar_pelagic', 'marine', [0.04, 0.18, 0.32], 'Frigid circumpolar current'],
  ['ma_arctic_ocean', 'Arctic Ocean Pack-Ice Basin', 'Arctic_Ocean', 'polar_ice', 82.0, 0.0, 14, -4200, -10, 'glacial', 'polar_pelagic', 'marine', [0.16, 0.32, 0.44], 'Perennial sea-ice ocean']
];

export const ECOREGION_CATALOG = RAW_ECOREGIONS.map((e, idx) => ({
  index: idx,
  id: e[0],
  name: e[1],
  realm: e[2],
  biomeClass: e[3],
  latDeg: e[4],
  lonDeg: e[5],
  radiusDeg: e[6],
  minElevM: e[7],
  maxElevM: e[8],
  lithology: e[9],
  floraGuild: e[10],
  waterType: e[11],
  tint: e[12],
  climateNote: e[13]
}));

export function biogeographicRealmAt(latDeg, lonDeg, isMarine = false) {
  if (isMarine) {
    if (latDeg > 66.5) return 'Arctic_Ocean';
    if (latDeg < -55.0) return 'Southern_Ocean';
    if (latDeg > 8 && latDeg < 28 && lonDeg > -98 && lonDeg < -60) return 'Caribbean';
    if (latDeg > -25 && latDeg < 25 && lonDeg > 98 && lonDeg < 158) return 'Indo_Pacific';
    if (lonDeg >= 20 && lonDeg <= 120 && latDeg < 30) return 'Indian_Ocean';
    if (lonDeg > -72 && lonDeg < 20) return 'Atlantic';
    return 'Pacific';
  }
  if (latDeg < -58.0) return 'Antarctic';
  if (latDeg > 67.5) return 'Arctic';
  if (latDeg > -26 && latDeg < -11 && lonDeg > 42 && lonDeg < 51) return 'Madagascar';
  if (lonDeg < -30) {
    return latDeg > 23.0 ? 'Nearctic' : 'Neotropics';
  }
  if (lonDeg >= -20 && lonDeg <= 55 && latDeg < 28.0) return 'Afrotropics';
  if (lonDeg > 60 && lonDeg < 145 && latDeg < 31.0 && latDeg > -10.5) return 'Indomalaya';
  if (lonDeg >= 108 && latDeg <= -8.0) return 'Australasia';
  return 'Palearctic';
}

// Fast geographically grounded ecoregion classifier (combines spatial proximity, elevation, water type & climate)
export function classifyEcoregionAt(latDeg, lonDeg, elevM, tempC = 18, rainfall = 0.5, aridity = 0.1, glacierFrac = 0) {
  const isMarine = elevM < -0.5;
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < ECOREGION_CATALOG.length; i++) {
    const e = ECOREGION_CATALOG[i];
    const eMarine = e.waterType === 'marine';
    if (isMarine !== eMarine) continue;

    let dLon = abs(lonDeg - e.lonDeg);
    if (dLon > 180) dLon = 360 - dLon;
    const cosL = Math.max(0.22, cos(latDeg * DEG2RAD));
    const dist = hypot(dLon * cosL, latDeg - e.latDeg);
    let score = dist / Math.max(2.0, e.radiusDeg);

    // Respect vertical elevation/depth niches (alpine vs lowland, shelf vs abyssal trench)
    if (elevM < e.minElevM) score += (e.minElevM - elevM) / 2600;
    if (elevM > e.maxElevM) score += (elevM - e.maxElevM) / 2600;
    if (!isMarine) {
      if (glacierFrac > 0.45 && e.biomeClass !== 'polar_ice' && e.biomeClass !== 'alpine') score += 0.9;
      if (aridity > 0.55 && e.biomeClass !== 'hot_desert' && e.biomeClass !== 'cold_desert') score += 0.7;
      if (aridity < 0.20 && (e.biomeClass === 'hot_desert' || e.biomeClass === 'cold_desert')) score += 0.8;
    }

    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }

  return best || ECOREGION_CATALOG[0];
}
