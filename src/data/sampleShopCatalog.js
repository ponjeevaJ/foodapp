const MENU_PROFILES = {
  rice: [
    { itemName: "Chicken Fried Rice", category: "Rice", price: 220, veg: false },
    { itemName: "Chicken Rice Bowl", category: "Rice Bowl", price: 235, veg: false },
    { itemName: "Veg Fried Rice", category: "Rice", price: 185, veg: true },
    { itemName: "Chicken Dum Biryani", category: "Biryani", price: 255, veg: false }
  ],
  paneer: [
    { itemName: "Paneer Butter Masala", category: "North Indian Curry", price: 240, veg: true },
    { itemName: "Paneer Tikka", category: "Tandoor", price: 215, veg: true },
    { itemName: "Dal Makhani", category: "North Indian Curry", price: 195, veg: true },
    { itemName: "Butter Naan", category: "Bread", price: 55, veg: true }
  ],
  parotta: [
    { itemName: "Malabar Parotta", category: "Flatbread", price: 85, veg: true },
    { itemName: "Egg Parotta", category: "Flatbread", price: 125, veg: false },
    { itemName: "Kothu Parotta", category: "Street Food", price: 190, veg: false },
    { itemName: "Chicken Curry", category: "Curry", price: 220, veg: false }
  ],
  south: [
    { itemName: "Masala Dosa", category: "South Indian Breakfast", price: 120, veg: true },
    { itemName: "Idli Sambar", category: "South Indian Breakfast", price: 85, veg: true },
    { itemName: "Parotta", category: "Flatbread", price: 75, veg: true },
    { itemName: "Veg Meals", category: "South Indian Meals", price: 165, veg: true }
  ],
  chinese: [
    { itemName: "Chicken Hakka Noodles", category: "Noodles", price: 225, veg: false },
    { itemName: "Chicken Fried Rice", category: "Rice", price: 215, veg: false },
    { itemName: "Chilli Paneer", category: "Indo-Chinese Starter", price: 205, veg: true },
    { itemName: "Veg Manchurian", category: "Indo-Chinese Starter", price: 175, veg: true }
  ],
  biryani: [
    { itemName: "Chicken Dum Biryani", category: "Biryani", price: 265, veg: false },
    { itemName: "Paneer Dum Biryani", category: "Biryani", price: 225, veg: true },
    { itemName: "Mutton Biryani", category: "Biryani", price: 315, veg: false },
    { itemName: "Chicken 65", category: "Starter", price: 185, veg: false }
  ],
  north: [
    { itemName: "Paneer Butter Masala", category: "North Indian Curry", price: 245, veg: true },
    { itemName: "Butter Naan", category: "Bread", price: 60, veg: true },
    { itemName: "Dal Makhani", category: "North Indian Curry", price: 205, veg: true },
    { itemName: "Chicken Tikka Masala", category: "North Indian Curry", price: 275, veg: false }
  ],
  tiffin: [
    { itemName: "Idli Sambar", category: "South Indian Breakfast", price: 80, veg: true },
    { itemName: "Pongal", category: "South Indian Breakfast", price: 95, veg: true },
    { itemName: "Onion Dosa", category: "South Indian Breakfast", price: 115, veg: true },
    { itemName: "Parotta", category: "Flatbread", price: 70, veg: true }
  ],
  meals: [
    { itemName: "South Indian Meals", category: "Meals", price: 175, veg: true },
    { itemName: "Chicken Meals", category: "Meals", price: 225, veg: false },
    { itemName: "Sambar Rice", category: "Rice", price: 125, veg: true },
    { itemName: "Egg Parotta", category: "Flatbread", price: 130, veg: false }
  ],
  street: [
    { itemName: "Egg Parotta", category: "Street Food", price: 120, veg: false },
    { itemName: "Kothu Parotta", category: "Street Food", price: 185, veg: false },
    { itemName: "Chicken Rice Bowl", category: "Rice Bowl", price: 220, veg: false },
    { itemName: "Paneer 65", category: "Starter", price: 195, veg: true }
  ],
  cafe: [
    { itemName: "Paneer Butter Masala Wrap", category: "Paneer Butter Masala", price: 195, veg: true },
    { itemName: "Chicken Rice Bowl", category: "Rice Bowl", price: 225, veg: false },
    { itemName: "Veg Pulao", category: "Rice", price: 175, veg: true },
    { itemName: "Parotta Wrap", category: "Flatbread", price: 155, veg: true }
  ],
  tandoor: [
    { itemName: "Paneer Tikka", category: "Tandoor", price: 225, veg: true },
    { itemName: "Chicken Tikka", category: "Tandoor", price: 265, veg: false },
    { itemName: "Butter Naan", category: "Bread", price: 55, veg: true },
    { itemName: "Chicken Dum Biryani", category: "Biryani", price: 275, veg: false }
  ],
  curry: [
    { itemName: "Paneer Butter Masala", category: "North Indian Curry", price: 235, veg: true },
    { itemName: "Chicken Curry", category: "Curry", price: 225, veg: false },
    { itemName: "Jeera Rice", category: "Rice", price: 145, veg: true },
    { itemName: "Malabar Parotta", category: "Flatbread", price: 90, veg: true }
  ],
  noodles: [
    { itemName: "Chicken Hakka Noodles", category: "Noodles", price: 220, veg: false },
    { itemName: "Paneer Noodles", category: "Noodles", price: 205, veg: true },
    { itemName: "Chicken Fried Rice", category: "Rice", price: 215, veg: false },
    { itemName: "Veg Fried Rice", category: "Rice", price: 180, veg: true }
  ],
  classic: [
    { itemName: "Chicken Rice Bowl", category: "Rice Bowl", price: 230, veg: false },
    { itemName: "Paneer Butter Masala", category: "North Indian Curry", price: 245, veg: true },
    { itemName: "Malabar Parotta", category: "Flatbread", price: 85, veg: true },
    { itemName: "Masala Dosa", category: "South Indian Breakfast", price: 125, veg: true }
  ]
};

function shop(shopId, shopName, rating, distanceKm, bearing, menuProfile, etaMinutes) {
  return {
    shopId,
    shopName,
    rating,
    distanceKm,
    bearing,
    etaMinutes,
    menu: MENU_PROFILES[menuProfile].map((item, index) => ({
      itemId: `${shopId}-item-${index + 1}`,
      ...item
    }))
  };
}

const SHARED_SHOPS = {
  curryLeaf: ["Curry Leaf Kitchen", 4.5, 0.35, 35, "rice", 30],
  greenBowl: ["Green Bowl House", 4.4, 0.95, 150, "paneer", 34],
  malabarMeals: ["Malabar Meals", 4.3, 1.25, 260, "parotta", 38]
};

function sharedShop(id, values) {
  return shop(id, ...values);
}

const SAMPLE_SHOPS_BY_APP = {
  Zomato: [
    sharedShop("zomato-curry-leaf", SHARED_SHOPS.curryLeaf),
    sharedShop("zomato-green-bowl", SHARED_SHOPS.greenBowl),
    sharedShop("zomato-malabar-meals", SHARED_SHOPS.malabarMeals),
    shop("zomato-madras-tiffin", "Madras Tiffin Studio", 4.2, 1.5, 340, "tiffin", 28),
    shop("zomato-wok-bowl", "Wok and Bowl", 4.3, 1.9, 45, "chinese", 36),
    shop("zomato-dum-counter", "Dum Biryani Counter", 4.6, 2.3, 140, "biryani", 40),
    shop("zomato-naan-garden", "Naan Garden", 4.1, 2.8, 225, "north", 42),
    shop("zomato-idli-express", "Idli Express", 4.4, 3.3, 280, "south", 26),
    shop("zomato-spice-route", "Spice Route Cafe", 4.0, 3.8, 20, "cafe", 37),
    shop("zomato-curry-bazaar", "Curry Bazaar", 4.2, 4.1, 170, "curry", 44),
    shop("zomato-street-tawa", "Street Tawa", 4.1, 4.4, 310, "street", 32),
    shop("zomato-urban-thali", "Urban Thali Co", 4.5, 4.7, 100, "meals", 46),
    shop("zomato-noodle-house", "Noodle House", 4.3, 3.5, 65, "noodles", 39),
    shop("zomato-tandoor-corner", "Tandoor Corner", 4.4, 4.8, 50, "tandoor", 41),
    shop("zomato-paneer-palace", "Paneer Palace", 4.5, 4.9, 230, "paneer", 43)
  ],
  Swiggy: [
    sharedShop("swiggy-curry-leaf", SHARED_SHOPS.curryLeaf),
    sharedShop("swiggy-green-bowl", SHARED_SHOPS.greenBowl),
    sharedShop("swiggy-malabar-meals", SHARED_SHOPS.malabarMeals),
    shop("swiggy-tandoori-trails", "Tandoori Trails", 4.6, 0.55, 215, "tandoor", 29),
    shop("swiggy-rice-pot", "Rice Pot Kitchen", 4.2, 1.1, 80, "rice", 31),
    shop("swiggy-roti-junction", "Roti Junction", 4.3, 1.7, 120, "north", 35),
    shop("swiggy-chinese-corner", "Chinese Corner", 4.1, 2.1, 330, "chinese", 34),
    shop("swiggy-biryani-court", "Biryani Court", 4.7, 2.6, 10, "biryani", 37),
    shop("swiggy-breakfast-club", "Breakfast Club", 4.2, 3.1, 260, "tiffin", 27),
    shop("swiggy-parotta-point", "Parotta Point", 4.4, 3.6, 200, "parotta", 33),
    shop("swiggy-family-meals", "Family Meals Hub", 4.5, 4.2, 75, "meals", 45),
    shop("swiggy-street-spice", "Street Spice Kitchen", 4.0, 4.5, 300, "street", 36),
    shop("swiggy-city-cafe", "City Cafe Bowl", 4.1, 4.8, 25, "cafe", 39),
    shop("swiggy-noodle-lab", "Noodle Lab", 4.3, 4.6, 155, "noodles", 40),
    shop("swiggy-curry-house", "Curry House Express", 4.4, 4.9, 245, "curry", 42)
  ],
  Toing: [
    sharedShop("toing-curry-leaf", SHARED_SHOPS.curryLeaf),
    sharedShop("toing-green-bowl", SHARED_SHOPS.greenBowl),
    sharedShop("toing-malabar-meals", SHARED_SHOPS.malabarMeals),
    shop("toing-rice-canteen", "Rice Canteen", 4.0, 0.65, 95, "rice", 35),
    shop("toing-paneer-kitchen", "Paneer Kitchen", 4.2, 1.3, 170, "paneer", 38),
    shop("toing-kothu-corner", "Kothu Corner", 4.1, 1.8, 225, "street", 32),
    shop("toing-south-spoon", "South Spoon", 4.4, 2.2, 280, "south", 29),
    shop("toing-wok-station", "Wok Station", 4.0, 2.7, 40, "noodles", 41),
    shop("toing-biryani-stop", "Biryani Stop", 4.3, 3.2, 135, "biryani", 44),
    shop("toing-naan-counter", "Naan Counter", 4.2, 3.7, 205, "north", 39),
    shop("toing-cafe-bowl", "Cafe Bowl Works", 4.1, 4.0, 15, "cafe", 40),
    shop("toing-meals-mandir", "Meals Mandir", 4.5, 4.3, 110, "meals", 43),
    shop("toing-tandoor-house", "Tandoor House", 4.2, 4.6, 55, "tandoor", 42),
    shop("toing-parotta-yard", "Parotta Yard", 4.3, 4.8, 190, "parotta", 34),
    shop("toing-classic-kitchen", "Classic Kitchen", 4.4, 4.9, 320, "classic", 37)
  ]
};

function getProviderShops(provider) {
  return SAMPLE_SHOPS_BY_APP[provider] || [];
}

function getMenuItemNames() {
  return [...new Set(Object.values(SAMPLE_SHOPS_BY_APP)
    .flatMap((shops) => shops.flatMap((entry) => entry.menu.map((item) => item.itemName))))];
}

module.exports = { getMenuItemNames, getProviderShops };
